const express = require("express");
const app = express();
const http = require("http");
const socketio = require("socket.io");
const path = require("path");
const axios = require("axios");
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

// Store connected users and their latest location data
const connectedUsers = new Map();
// Store active usernames (case-insensitive)
const activeUsernames = new Set();

// Cache for news data with 1-hour expiration
const newsCache = {
  data: null,
  timestamp: null,
  isValid: function() {
    if (!this.data || !this.timestamp) {
      return false;
    }
    const fourHours = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
    return Date.now() - this.timestamp < fourHours;
  },
  set: function(data) {
    this.data = data;
    this.timestamp = Date.now();
  },
  get: function() {
    return this.isValid() ? this.data : null;
  },
  clear: function() {
    this.data = null;
    this.timestamp = null;
  }
};

io.on("connection", function (socket) {
  console.log(`User connected: ${socket.id}`);

  socket.on("set-name", function (data) {
    const requestedName = data.name.trim();
    const requestedNameLower = requestedName.toLowerCase();

    // Check if username already exists (case-insensitive)
    if (activeUsernames.has(requestedNameLower)) {
      socket.emit("name-rejected", { 
        reason: "Username already taken." 
      });
      return;
    }

    // Check if username is too short or contains invalid characters
    if (requestedName.length < 2) {
      socket.emit("name-rejected", { 
        reason: "Must at least 2 characters long." 
      });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(requestedName)) {
      socket.emit("name-rejected", { 
        reason: "Username is invalid." 
      });
      return;
    }

    // If we reach here, the username is valid
    socket.userName = requestedName;
    socket.userGender = data.gender;
    activeUsernames.add(requestedNameLower);

    console.log(`User ${socket.id} set name to: ${requestedName}, gender: ${data.gender}`);

    // Broadcast user connection to all clients
    io.emit("user-connected", { name: requestedName, gender: data.gender });

    // Send existing users' locations to the newly named user
    connectedUsers.forEach((userData, userId) => {
      if (userId !== socket.id && userData.location) {
        socket.emit("receive-location", {
          id: userId,
          name: userData.name,
          gender: userData.gender,
          latitude: userData.location.latitude,
          longitude: userData.location.longitude
        });
      }
    });
  });

  socket.on("send-location", function (data) {
    const displayName = socket.userName || socket.id;
    console.log(
      `Location received from ${displayName}: ${data.latitude}, ${data.longitude}`
    );

    // Store user's location data
    connectedUsers.set(socket.id, {
      name: socket.userName,
      gender: socket.userGender,
      location: { latitude: data.latitude, longitude: data.longitude }
    });

    io.emit("receive-location", { id: socket.id, name: socket.userName, gender: socket.userGender, ...data });
  });

  socket.on("send-notification", function (data) {
    const displayName = socket.userName || socket.id;
    console.log(
      `Chat message received from ${displayName}: ${data.message}`
    );
    io.emit("receive-notification", { id: socket.id, name: socket.userName, gender: socket.userGender, ...data });
  });

  socket.on("disconnect", function () {
    const displayName = socket.userName || socket.id;
    console.log(`User disconnected: ${displayName} (${socket.id})`);

    // Broadcast user disconnection to all clients (only if user had a name)
    if (socket.userName) {
      io.emit("user-left", { name: socket.userName, gender: socket.userGender });
      // Remove username from active set
      activeUsernames.delete(socket.userName.toLowerCase());
    }

    // Remove user from connected users map
    connectedUsers.delete(socket.id);

    io.emit("user-disconnected", socket.id);
  });
});

// News API endpoint
app.get("/api/news", async function (req, res) {
  try {
    // Check cache first
    const cachedNews = newsCache.get();
    if (cachedNews) {
      console.log(`Returning cached news data with ${cachedNews.length} articles`);
      res.set('x-cache-status', 'HIT');
      res.json(cachedNews);
      return;
    }

    console.log('Cache miss - fetching fresh news data from API');

    // You'll need to get a free API key from https://gnews.io
    const GNEWS_API_KEY = process.env.GNEWS_API_KEY || '508253d8de3ed1d9a55f779690c4253c';

    // Calculate date for last 72 hours (today, yesterday, and day before)
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000));
    const fromDate = threeDaysAgo.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // Reduced search strategies to avoid API rate limiting
    const searches = [
      // Strategy 1: Primary Malaysia search with high priority terms
      {
        token: GNEWS_API_KEY,
        q: 'Malaysia OR Malaysian OR "Kuala Lumpur" OR "Prime Minister Malaysia" OR Anwar Ibrahim',
        lang: 'en',
        max: 30,
        in: 'title,description',
        from: fromDate,
        sortby: 'publishedAt'
      },
      // Strategy 2: Malaysian states and major cities
      {
        token: GNEWS_API_KEY,
        q: '"Kuala Lumpur" OR Johor OR Selangor OR Penang OR Sabah OR Sarawak OR Putrajaya',
        lang: 'en',
        max: 20,
        in: 'title,description',
        from: fromDate,
        sortby: 'publishedAt'
      },
      // Strategy 3: Country-specific search (most reliable)
      {
        token: GNEWS_API_KEY,
        lang: 'en',
        country: 'my',
        max: 25,
        in: 'title,description',
        from: fromDate,
        sortby: 'publishedAt'
      }
    ];

    let allArticles = [];

    for (let i = 0; i < searches.length; i++) {
      try {
        // Add delay between requests to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }

        const response = await axios.get(`https://gnews.io/api/v4/search`, {
          params: searches[i],
          timeout: 10000
        });

        if (response.data.articles) {
          allArticles = allArticles.concat(response.data.articles);
        }
      } catch (searchError) {
        // Continue with next strategy instead of failing completely
      }
    }

    // Remove duplicates based on title
    const uniqueArticles = allArticles.filter((article, index, self) => 
      index === self.findIndex(a => a.title === article.title)
    );

    // Additional filter to ensure only last 72 hours articles (client-side verification)
    const seventyTwoHoursAgo = new Date(Date.now() - (72 * 60 * 60 * 1000));
    const recentArticles = uniqueArticles.filter(article => {
      if (!article.publishedAt) {
        console.log(`Article missing publishedAt date: ${article.title.substring(0, 50)}...`);
        return true; // Keep articles without dates for now
      }

      const publishDate = new Date(article.publishedAt);

      // Check if date is valid
      if (isNaN(publishDate.getTime())) {
        console.log(`Invalid publish date for article: ${article.title.substring(0, 50)}...`);
        return true; // Keep articles with invalid dates for now
      }

      const isRecent = publishDate >= seventyTwoHoursAgo;
      return isRecent;
    });

    const newsWithLocations = [];
    const articles = recentArticles || [];

    for (const article of articles) {
      try {
        // Extract location from title and description
        const location = await extractLocationFromNews(article);
        if (location && location.latitude && location.longitude) {
          newsWithLocations.push({
            ...article,
            location: location
          });
        } else {
          // Log failed geocoding attempts with source details
          console.log(`Failed to geocode article: "${article.title}" from ${article.source?.name || 'Unknown Source'} - URL: ${article.url}`);
        }
      } catch (locationError) {
        console.log(`Error processing article: "${article.title}" from ${article.source?.name || 'Unknown Source'} - URL: ${article.url} - Error: ${locationError.message}`);
      }
    }

    // Store both successful and failed articles for debugging
    global.lastFetchedArticles = {
      all: articles,
      successful: newsWithLocations,
      failed: articles.filter(article => !newsWithLocations.find(success => success.url === article.url))
    };

    // Ensure we always return valid JSON, even if empty
    if (!Array.isArray(newsWithLocations)) {
      console.error('newsWithLocations is not an array, returning empty array');
      const emptyResult = [];
      newsCache.set(emptyResult);
      res.json(emptyResult);
    } else {
      // Cache the successful result
      newsCache.set(newsWithLocations);
      console.log(`Cached ${newsWithLocations.length} news articles for 4 hours`);
      console.log(`Failed to geocode ${global.lastFetchedArticles.failed.length} articles`);
      res.set('x-cache-status', 'MISS');
      res.json(newsWithLocations);
    }
  } catch (error) {
    console.error('Error fetching news:', error.message);

    // Cache empty result to prevent repeated failed API calls
    const emptyResult = [];
    newsCache.set(emptyResult);

    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Function to extract and geocode location from news content
async function extractLocationFromNews(article) {
  try {
    const titleText = article.title || '';
    const descText = article.description || '';
    const sourceText = article.source?.name || '';
    const publishedAt = article.publishedAt || '';
    const fullText = `${titleText} ${descText} ${sourceText} ${publishedAt}`;

    // Enhanced Malaysia detection - include more keywords and patterns
    const malaysiaKeywords = /\b(Malaysia|Malaysian|Kuala Lumpur|KL|Putrajaya|Selangor|Johor|Perak|Pahang|Kedah|Kelantan|Terengganu|Sabah|Sarawak|Penang|Perlis|Negeri Sembilan|Malacca|Melaka|Ringgit|RM|Prime Minister.*Malaysia|Anwar Ibrahim|UMNO|Pakatan|Barisan|ASEAN.*Malaysia|Mahathir|Najib|Asia.*Malaysia|Southeast Asia|Golden Triangle|Cyberjaya|Genting|KLSE|Bursa Malaysia|Petronas|1MDB|MAS|AirAsia|TM|Telekom Malaysia|Malaysia Airlines|Proton|Perodua)\b/gi;

    // Check if article is Malaysia-related (more lenient check)
    const isMalaysiaRelated = malaysiaKeywords.test(fullText) || 
                             titleText.toLowerCase().includes('malaysia') ||
                             descText.toLowerCase().includes('malaysia') ||
                             sourceText.toLowerCase().includes('malaysia');

    if (!isMalaysiaRelated) {
      return null;
    }

    let foundLocation = null;

    // 1. First try to extract from dateline patterns (highest priority)
    const datelinePatterns = [
      // Malaysian cities in caps (common in news datelines)
      /\b(KUALA LUMPUR|PUTRAJAYA|SHAH ALAM|JOHOR BAHRU|GEORGE TOWN|IPOH|KUCHING|KOTA KINABALU|PETALING JAYA|KLANG|SEREMBAN|ALOR SETAR|KUALA TERENGGANU|KOTA BHARU|KUANTAN|MIRI|SIBU|SANDAKAN|TAWAU|LABUAN|CYBERJAYA|SUBANG JAYA|AMPANG|KAJANG)\b/gi,
      // Standard dateline with Malaysian cities: "KUALA LUMPUR, Malaysia, Aug 15"
      /\b(KUALA LUMPUR|PUTRAJAYA|JOHOR BAHRU|GEORGE TOWN|IPOH|KUCHING|KOTA KINABALU),?\s*(?:Malaysia,?\s*)?/gi,
      // Short form datelines: "KL -" or "PUTRAJAYA:"
      /\b(KL|PUTRAJAYA|IPOH|KUCHING)\s*[-:]/gi
    ];

    for (const pattern of datelinePatterns) {
      const matches = fullText.match(pattern);
      if (matches && matches.length > 0) {
        let location = matches[0];
        if (matches[1]) {
          location = matches[1].trim();
        }
        // Clean up the location and validate
        location = location.replace(/[-:,\s]+$/, '').replace(/^[-:,\s]+/, '').trim();

        // Validate location name (should be reasonable length and format)
        if (location.length >= 2 && location.length <= 50 && /^[A-Za-z\s]+$/.test(location)) {
          foundLocation = location;
          break;
        }
      }
    }

    // 2. If no dateline found, look for Malaysian location mentions in content
    if (!foundLocation) {
      const locationPatterns = [
        // Malaysian states and federal territories (case-insensitive)
        /\b(Kuala\s+Lumpur|Putrajaya|Labuan|Selangor|Johor|Perak|Pahang|Kedah|Kelantan|Terengganu|Sabah|Sarawak|Penang|Perlis|Negeri\s+Sembilan|Malacca|Melaka)\b/gi,
        // Major Malaysian cities and state capitals
        /\b(George\s+Town|Georgetown|Johor\s+Bahru|JB|Ipoh|Shah\s+Alam|Petaling\s+Jaya|PJ|Klang|Kuching|Kota\s+Kinabalu|KK|Alor\s+Setar|Kuala\s+Terengganu|KT|Kota\s+Bharu|KB|Kuantan|Seremban|Kangar)\b/gi,
        // Selangor cities and districts
        /\b(Cyberjaya|Subang\s+Jaya|Ampang|Kajang|Puchong|Cheras|Damansara|Rawang|Sepang|Nilai|Port\s+Dickson|PD|Banting|Hulu\s+Langat|Kuala\s+Langat|Gombak|Kuala\s+Selangor|Sabak\s+Bernam|Hulu\s+Selangor|Petaling|Teluk\s+Intan|Sungai\s+Buloh|Bangi|Serdang|Balakong)\b/gi,
        // Johor cities and districts  
        /\b(Kulai|Pontian|Kluang|Batu\s+Pahat|BP|Muar|Segamat|Kota\s+Tinggi|Mersing|Tangkak|Ledang|Iskandar|Nusajaya|Gelang\s+Patah|Pasir\s+Gudang|Skudai|Ulu\s+Tiram|Masai|Senai|Tampoi)\b/gi,
        // Perak cities and districts
        /\b(Taiping|Sungai\s+Petani|Kulim|Batu\s+Gajah|Tanjung\s+Malim|Kampar|Lumut|Sitiawan|Manjung|Larut\s+Matang|Kinta|Kuala\s+Kangsar|Perak\s+Tengah|Batang\s+Padang|Hilir\s+Perak|Hulu\s+Perak|Selama|Parit\s+Buntar|Changkat\s+Jering)\b/gi,
        // Pahang cities and districts
        /\b(Bentong|Cameron\s+Highlands|Cameron|Jerantut|Bera|Pekan|Rompin|Temerloh|Maran|Lipis|Raub|Fraser\s+Hill|Fraserhill|Genting|Genting\s+Highlands|Mentakab|Kuala\s+Lipis|Chenor|Muadzam\s+Shah)\b/gi,
        // Kedah and Perlis cities and districts
        /\b(Kota\s+Setar|Kubang\s+Pasu|Pokok\s+Sena|Padang\s+Terap|Pendang|Sik|Baling|Bandar\s+Baharu|Yan|Kuala\s+Muda|Padang\s+Besar|Arau|Langkawi|Sungai\s+Petani)\b/gi,
        // Penang areas and districts
        /\b(Butterworth|Bukit\s+Mertajam|Nibong\s+Tebal|Balik\s+Pulau|Northeast\s+Penang|Southwest\s+Penang|Seberang\s+Perai|Central\s+Seberang\s+Perai|North\s+Seberang\s+Perai|South\s+Seberang\s+Perai|Bayan\s+Lepas|Tanjung\s+Bungah)\b/gi,
        // Kelantan cities and districts
        /\b(Bachok|Machang|Pasir\s+Mas|Pasir\s+Puteh|Tanah\s+Merah|Tumpat|Gua\s+Musang|Kuala\s+Krai|Jeli|Wakaf\s+Baharu|Rantau\s+Panjang|Dabong)\b/gi,
        // Terengganu cities and districts
        /\b(Besut|Dungun|Hulu\s+Terengganu|Kemaman|Kuala\s+Nerus|Marang|Setiu|Chukai|Kerteh|Jerteh|Ajil|Paka)\b/gi,
        // Negeri Sembilan cities and districts
        /\b(Jelebu|Jempol|Kuala\s+Pilah|Rembau|Tampin|Alor\s+Gajah|Jasin|Melaka\s+Tengah|Central\s+Melaka|Bahau|Gemas|Kuala\s+Klawang)\b/gi,
        // Sabah cities and districts
        /\b(Sandakan|Tawau|Kudat|Lahad\s+Datu|Kota\s+Belud|Beaufort|Keningau|Ranau|Semporna|Kunak|Beluran|Tongod|Kota\s+Marudu|Pitas|Tuaran|Penampang|Papar|Putatan|Tenom|Nabawan|Kalabakan|Kuala\s+Penyu|Sipitang)\b/gi,
        // Sarawak cities and districts
        /\b(Miri|Sibu|Bintulu|Limbang|Lawas|Marudi|Belaga|Kapit|Song|Kanowit|Sarikei|Meradong|Julau|Pakan|Betong|Saratok|Roban|Kabong|Dalat|Mukah|Daro|Matu|Telang\s+Usan|Balingian|Tatau|Bintangor|Sebauh|Beluru|Kota\s+Samarahan|Sri\s+Aman)\b/gi,
        // Location with prepositions
        /\bin\s+(Kuala\s+Lumpur|Putrajaya|Selangor|Johor|Perak|Pahang|Kedah|Kelantan|Terengganu|Sabah|Sarawak|Penang|Perlis|Negeri\s+Sembilan|Malacca|Melaka|George\s+Town|Johor\s+Bahru|Ipoh|Shah\s+Alam|Petaling\s+Jaya|Klang|Kuching|Kota\s+Kinabalu|Malaysia)\b/gi,
        /\bat\s+(Kuala\s+Lumpur|Putrajaya|Selangor|Johor|Perak|Pahang|Kedah|Kelantan|Terengganu|Sabah|Sarawak|Penang|Perlis|Negeri\s+Sembilan|Malacca|Melaka|George\s+Town|Johor\s+Bahru|Ipoh|Shah\s+Alam|Petaling\s+Jaya|Klang|Kuching|Kota\s+Kinabalu|Malaysia)\b/gi,
        /\bfrom\s+(Kuala\s+Lumpur|Putrajaya|Selangor|Johor|Perak|Pahang|Kedah|Kelantan|Terengganu|Sabah|Sarawak|Penang|Perlis|Negeri\s+Sembilan|Malacca|Melaka|George\s+Town|Johor\s+Bahru|Ipoh|Shah\s+Alam|Petaling\s+Jaya|Klang|Kuching|Kota\s+Kinabalu|Malaysia)\b/gi
      ];

      let bestMatch = null;

      // Try each pattern and find the best match
      for (const pattern of locationPatterns) {
        const matches = fullText.match(pattern);
        if (matches && matches.length > 0) {
          for (const match of matches) {
            const cleanMatch = match.replace(/^(in|from|at)\s+/i, '').trim();

            // Validate the match before using it
            if (cleanMatch.length >= 3 && cleanMatch.length <= 50 && /^[A-Za-z\s]+$/.test(cleanMatch)) {
              if (!bestMatch || cleanMatch.length > bestMatch.length) {
                bestMatch = cleanMatch;
              }
            }
          }
        }
      }

      if (bestMatch) {
        foundLocation = bestMatch;
      }
    }

    // 3. If still no location, try Malaysia as default for Malaysia-related news
    if (!foundLocation && isMalaysiaRelated) {
      foundLocation = 'Kuala Lumpur'; // Default to capital city
    }

    if (!foundLocation) {
      return null;
    }

    // Geocode the location using GeoNames
    const geoLocation = await geocodeLocation(foundLocation);
    return geoLocation;

  } catch (error) {
    console.error('Error extracting location:', error);
    return null;
  }
}

// Function to geocode location using GeoNames API with enhanced Malaysian location handling
async function geocodeLocation(locationName) {
  try {
    const GEONAMES_USERNAME = process.env.GEONAMES_USERNAME || 'maia.aio';

    // Clean and normalize the location name
    let cleanLocation = locationName.replace(/[^\w\s,.-]/g, '').trim();

    // Validate location name length and format
    if (!cleanLocation || cleanLocation.length < 2 || cleanLocation.length > 50) {
      return null;
    }

    // Remove invalid patterns that cause geocoding failures
    const invalidPatterns = [
      /^[A-Z\s]+ (PM|calls|Orders|Probe|Attack|Death|Flash|Launches|authorities|Seizes)/i,
      /\b(PM|calls for probe|Orders Probe|Attack on|Death of|Flash floods|Launches|authorities seize|Seizes)\b/i
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(cleanLocation)) {
        return null;
      }
    }

    // Handle common Malaysian location variations and aliases
    const locationAliases = {
      'KL': 'Kuala Lumpur',
      'PJ': 'Petaling Jaya',
      'JB': 'Johor Bahru',
      'George Town': 'Georgetown',
      'Malacca': 'Melaka',
      'Golden Triangle': 'Kuala Lumpur',
      'IOI City Mall': 'Putrajaya',
      'Genting': 'Genting Highlands'
    };

    // Apply aliases
    for (const [alias, actual] of Object.entries(locationAliases)) {
      if (cleanLocation.toLowerCase() === alias.toLowerCase() || 
          cleanLocation.toLowerCase().includes(alias.toLowerCase())) {
        cleanLocation = actual;
        break;
      }
    }

    // Final validation - must be a proper location name
    if (!/^[A-Za-z\s]+$/.test(cleanLocation)) {
      return null;
    }

    // Enhanced search strategies with more specific Malaysian targeting
    const searchStrategies = [
      // Strategy 1: Direct search within Malaysia for populated places
      {
        q: cleanLocation,
        maxRows: 10,
        username: GEONAMES_USERNAME,
        country: 'MY',
        featureClass: 'P',
        orderby: 'population',
        type: 'json'
      },
      // Strategy 2: Administrative divisions (states) in Malaysia
      {
        q: cleanLocation,
        maxRows: 10,
        username: GEONAMES_USERNAME,
        country: 'MY',
        featureClass: 'A',
        orderby: 'population',
        type: 'json'
      },
      // Strategy 3: All features in Malaysia
      {
        q: cleanLocation,
        maxRows: 10,
        username: GEONAMES_USERNAME,
        country: 'MY',
        orderby: 'relevance',
        type: 'json'
      },
      // Strategy 4: Fuzzy search for Malaysian locations
      {
        q: cleanLocation,
        maxRows: 10,
        username: GEONAMES_USERNAME,
        country: 'MY',
        fuzzy: 0.8,
        type: 'json'
      },
      // Strategy 5: Search with "Malaysia" appended
      {
        q: `${cleanLocation} Malaysia`,
        maxRows: 10,
        username: GEONAMES_USERNAME,
        orderby: 'relevance',
        type: 'json'
      }
    ];

    for (const strategy of searchStrategies) {
      try {
        const response = await axios.get(`http://api.geonames.org/searchJSON`, {
          params: strategy,
          timeout: 5000
        });

        if (response.data.geonames && response.data.geonames.length > 0) {
          // Filter and prioritize results
          const candidates = response.data.geonames
            .filter(place => {
              // Must be in Malaysia
              if (place.countryCode !== 'MY' && place.countryName !== 'Malaysia') {
                return false;
              }

              // Validate coordinates
              const lat = parseFloat(place.lat);
              const lng = parseFloat(place.lng);
              if (isNaN(lat) || isNaN(lng)) {
                return false;
              }

              // Check Malaysian bounds (extended slightly for offshore territories)
              return lat >= 0.5 && lat <= 7.5 && lng >= 99.0 && lng <= 120.0;
            })
            .sort((a, b) => {
              // Prioritize by population, then by name similarity
              const popA = parseInt(a.population) || 0;
              const popB = parseInt(b.population) || 0;

              if (popA !== popB) {
                return popB - popA; // Higher population first
              }

              // If populations are similar, prefer exact name matches
              const nameMatchA = a.name.toLowerCase() === cleanLocation.toLowerCase() ? 1 : 0;
              const nameMatchB = b.name.toLowerCase() === cleanLocation.toLowerCase() ? 1 : 0;

              return nameMatchB - nameMatchA;
            });

          if (candidates.length > 0) {
            const place = candidates[0];
            const lat = parseFloat(place.lat);
            const lng = parseFloat(place.lng);

            return {
              name: place.name,
              latitude: lat,
              longitude: lng,
              country: place.countryName,
              adminName: place.adminName1 || '',
              originalQuery: locationName,
              population: place.population || 0
            };
          }
        }
      } catch (strategyError) {
        continue;
      }
    }

    return null;

  } catch (error) {
    console.error('Error geocoding location:', error);
    return null;
  }
}

// Crisis data cache with 30-minute expiration
const crisisCache = {
  data: null,
  timestamp: null,
  isValid: function() {
    if (!this.data || !this.timestamp) {
      return false;
    }
    const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
    return Date.now() - this.timestamp < thirtyMinutes;
  },
  set: function(data) {
    this.data = data;
    this.timestamp = Date.now();
  },
  get: function() {
    return this.isValid() ? this.data : null;
  },
  clear: function() {
    this.data = null;
    this.timestamp = null;
  }
};

// Crisis API endpoint
app.get("/api/crisis", async function (req, res) {
  try {
    // Check cache first
    const cachedCrisis = crisisCache.get();
    if (cachedCrisis) {
      console.log(`Returning cached crisis data with ${cachedCrisis.length} incidents`);
      res.set('x-cache-status', 'HIT');
      res.json(cachedCrisis);
      return;
    }

    console.log('Cache miss - fetching fresh crisis data from APIs');

    let allCrisisData = [];

    // Fetch earthquake data from USGS
    try {
      const earthquakeResponse = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
        timeout: 10000
      });

      if (earthquakeResponse.data && earthquakeResponse.data.features) {
        const earthquakes = earthquakeResponse.data.features.map(quake => {
          const props = quake.properties;
          const coords = quake.geometry.coordinates;
          
          return {
            id: quake.id,
            type: 'earthquake',
            title: props.title,
            magnitude: props.mag,
            location: props.place,
            time: new Date(props.time).toISOString(),
            latitude: coords[1],
            longitude: coords[0],
            depth: coords[2],
            status: props.status,
            tsunami: props.tsunami,
            severity: props.mag >= 6.0 ? 'severe' : props.mag >= 4.0 ? 'moderate' : 'minor',
            url: props.url,
            image: null // USGS doesn't provide images
          };
        });

        allCrisisData = allCrisisData.concat(earthquakes);
      }
    } catch (earthquakeError) {
      console.error('Error fetching earthquake data:', earthquakeError.message);
    }

    // Fetch wildfire data from NASA FIRMS
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateString = yesterday.toISOString().split('T')[0];

      const wildfireResponse = await axios.get(`https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv`, {
        timeout: 10000
      });

      if (wildfireResponse.data) {
        const lines = wildfireResponse.data.split('\n');
        const headers = lines[0].split(',');
        
        const latIndex = headers.indexOf('latitude');
        const lonIndex = headers.indexOf('longitude');
        const brightIndex = headers.indexOf('brightness');
        const confIndex = headers.indexOf('confidence');
        const dateIndex = headers.indexOf('acq_date');
        const timeIndex = headers.indexOf('acq_time');

        const wildfires = lines.slice(1, 51).map((line, index) => { // Limit to 50 fires
          const values = line.split(',');
          if (values.length < headers.length) return null;

          const lat = parseFloat(values[latIndex]);
          const lon = parseFloat(values[lonIndex]);
          const brightness = parseFloat(values[brightIndex]);
          const confidence = parseFloat(values[confIndex]);

          if (isNaN(lat) || isNaN(lon) || confidence < 50) return null;

          return {
            id: `fire_${index}`,
            type: 'wildfire',
            title: `Wildfire Detection`,
            location: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
            time: new Date().toISOString(),
            latitude: lat,
            longitude: lon,
            brightness: brightness,
            confidence: confidence,
            status: 'active',
            severity: brightness > 350 ? 'severe' : brightness > 320 ? 'moderate' : 'minor',
            image: null
          };
        }).filter(fire => fire !== null);

        allCrisisData = allCrisisData.concat(wildfires);
      }
    } catch (wildfireError) {
      console.error('Error fetching wildfire data:', wildfireError.message);
    }

    // Fetch flood data from USGS Water Services
    try {
      // Get current flood conditions from USGS
      const floodResponse = await axios.get('https://waterservices.usgs.gov/nwis/iv/', {
        params: {
          format: 'json',
          parameterCd: '00065', // Gage height
          siteStatus: 'active',
          hasDataTypeCd: 'iv',
          modifiedSince: 'PT2H' // Last 2 hours
        },
        timeout: 10000
      });

      if (floodResponse.data && floodResponse.data.value && floodResponse.data.value.timeSeries) {
        const floodSites = floodResponse.data.value.timeSeries
          .filter(site => {
            // Filter for sites with recent high water readings
            if (!site.values || !site.values[0] || !site.values[0].value) return false;
            
            const latestReading = site.values[0].value[site.values[0].value.length - 1];
            if (!latestReading || !latestReading.value) return false;
            
            const waterLevel = parseFloat(latestReading.value);
            return waterLevel > 10; // Filter for potentially significant water levels
          })
          .slice(0, 25) // Limit to 25 flood sites
          .map((site, index) => {
            const sourceInfo = site.sourceInfo;
            const latestValue = site.values[0].value[site.values[0].value.length - 1];
            const waterLevel = parseFloat(latestValue.value);
            
            return {
              id: `flood_${sourceInfo.siteCode[0].value}`,
              type: 'flood',
              title: `High Water Level Alert`,
              location: sourceInfo.siteName,
              time: latestValue.dateTime,
              latitude: parseFloat(sourceInfo.geoLocation.geogLocation.latitude),
              longitude: parseFloat(sourceInfo.geoLocation.geogLocation.longitude),
              waterLevel: waterLevel,
              unit: site.variable.unit.unitCode,
              status: 'monitoring',
              severity: waterLevel > 20 ? 'severe' : waterLevel > 15 ? 'moderate' : 'minor',
              siteCode: sourceInfo.siteCode[0].value,
              image: null
            };
          });

        allCrisisData = allCrisisData.concat(floodSites);
      }
    } catch (floodError) {
      console.error('Error fetching flood data:', floodError.message);
    }

    // Filter to only include recent and significant incidents
    const filteredCrisis = allCrisisData.filter(crisis => {
      const crisisTime = new Date(crisis.time);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      return crisisTime >= oneDayAgo && (
        (crisis.type === 'earthquake' && crisis.magnitude >= 3.0) ||
        (crisis.type === 'wildfire' && crisis.confidence >= 60) ||
        (crisis.type === 'flood' && crisis.waterLevel >= 10)
      );
    });

    // Sort by severity and time
    filteredCrisis.sort((a, b) => {
      const severityOrder = { severe: 3, moderate: 2, minor: 1 };
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;
      
      return new Date(b.time) - new Date(a.time);
    });

    // Cache the result
    crisisCache.set(filteredCrisis);
    console.log(`Cached ${filteredCrisis.length} crisis incidents for 30 minutes`);
    res.set('x-cache-status', 'MISS');
    res.json(filteredCrisis);

  } catch (error) {
    console.error('Error fetching crisis data:', error.message);
    
    // Cache empty result to prevent repeated failed API calls
    const emptyResult = [];
    crisisCache.set(emptyResult);
    
    res.status(500).json({ error: 'Failed to fetch crisis data' });
  }
});

// Debug endpoint to view all cached news articles
app.get("/api/news/debug", async function (req, res) {
  try {
    const cachedNews = newsCache.get();
    if (cachedNews) {
      res.json({
        successful_geocoded: cachedNews.length,
        articles: cachedNews
      });
    } else {
      res.json({ message: "No cached news data available" });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch debug news data' });
  }
});

// Endpoint to view failed geocoding articles
app.get("/api/news/failed", async function (req, res) {
  try {
    if (global.lastFetchedArticles && global.lastFetchedArticles.failed) {
      res.json({
        total_articles: global.lastFetchedArticles.all.length,
        successful_geocoded: global.lastFetchedArticles.successful.length,
        failed_geocoded: global.lastFetchedArticles.failed.length,
        failed_articles: global.lastFetchedArticles.failed.map(article => ({
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.source?.name || 'Unknown Source',
          publishedAt: article.publishedAt
        }))
      });
    } else {
      res.json({ message: "No failed articles data available. Fetch news first." });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch failed articles data' });
  }
});

app.get("/", function (req, res) {
  res.render("index");
});

server.listen(3000, () => {
  console.log("Server is running on port 3000");
});
