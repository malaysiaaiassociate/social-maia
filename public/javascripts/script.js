const socket = io();

let currentLocation = null;
let userName = null;
let userGender = null; // Added to store user's gender
let gpsEnabled = false;
let actualLocation = null;
let storedFakeLocation = null;
let lastSentLocation = null;
let lastLocationSentTime = 0;

// Location update throttling settings
const MIN_UPDATE_INTERVAL = 2000; // Minimum 2 seconds between updates
const MIN_DISTANCE_THRESHOLD = 5; // Minimum 5 meters movement to trigger update

const generateFakeLocation = (actualLat, actualLng) => {
  // Generate random point within 1000 meter radius
  const radiusInDegrees = 2000 / 111320; // Convert 1000 meters to degrees (approximately)
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * radiusInDegrees;

  const fakeLat = actualLat + (distance * Math.cos(angle));
  const fakeLng = actualLng + (distance * Math.sin(angle));

  return { latitude: fakeLat, longitude: fakeLng };
};

if (navigator.geolocation) {
  // Get initial position to set up fake location immediately if GPS is disabled
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      actualLocation = { latitude, longitude };

      if (gpsEnabled) {
        currentLocation = { latitude, longitude };
        storedFakeLocation = null;
      } else {
        // Generate initial fake location since GPS is disabled by default
        storedFakeLocation = generateFakeLocation(latitude, longitude);
        currentLocation = storedFakeLocation;
      }

      // Send initial location
      if (currentLocation && userName) {
        console.log(`Sending initial location: ${currentLocation.latitude}, ${currentLocation.longitude}`);
        socket.emit("send-location", { 
          latitude: currentLocation.latitude, 
          longitude: currentLocation.longitude, 
          name: userName,
          gender: userGender // Include gender in the emitted data
        });

        lastSentLocation = { ...currentLocation };
        lastLocationSentTime = Date.now();
      }
    },
    (error) => {
      console.log("Error getting initial location:", error);
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    }
  );

  // Continue watching position for updates
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      actualLocation = { latitude, longitude };

      if (gpsEnabled) {
        currentLocation = { latitude, longitude };
        storedFakeLocation = null; // Clear stored fake location when GPS is on
      } else {
        // Only generate new fake location if we don't have one stored
        if (!storedFakeLocation) {
          storedFakeLocation = generateFakeLocation(latitude, longitude);
        }
        currentLocation = storedFakeLocation;
      }

      // Only send location update if it meets our throttling criteria
      if (shouldSendLocationUpdate(currentLocation)) {
        console.log(`Sending location: ${currentLocation.latitude}, ${currentLocation.longitude}`);
        socket.emit("send-location", { 
          latitude: currentLocation.latitude, 
          longitude: currentLocation.longitude, 
          name: userName,
          gender: userGender // Include gender in the emitted data
        });

        // Update tracking variables
        lastSentLocation = { ...currentLocation };
        lastLocationSentTime = Date.now();
      }
    },
    (error) => {
      console.log(error);
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    }
  );
}

const map = L.map("map").setView([0, 0], 16);

// Define different map layers
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});

const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "© Esri"
});

const darkLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "© CartoDB"
});

const lightLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "© CartoDB"
});

// Set default layer
osmLayer.addTo(map);

// Create layer control
const baseMaps = {
  "OpenStreetMap": osmLayer,
  "Satellite": satelliteLayer,
  "Dark Theme": darkLayer,
  "Light Theme": lightLayer
};

L.control.layers(baseMaps).addTo(map);

// Store active notification popups to maintain them during zoom
const activeNotificationPopups = {};

// Prevent notification popups from closing during map interactions
map.on('zoomstart', function() {
  // Store currently open notification popups
  for (let userName in userMarkers) {
    if (userMarkers[userName] && userMarkers[userName].isPopupOpen()) {
      const popup = userMarkers[userName].getPopup();
      if (popup && popup.getContent().includes('style="text-align: center; min-width: 120px;"')) {
        activeNotificationPopups[userName] = {
          marker: userMarkers[userName],
          content: popup.getContent()
        };
      }
    }
  }
});

map.on('zoomend', function() {
  // Reopen notification popups after zoom
  for (let userName in activeNotificationPopups) {
    if (activeNotificationPopups[userName] && activeNotificationPopups[userName].marker) {
      const marker = activeNotificationPopups[userName].marker;
      const content = activeNotificationPopups[userName].content;

      // Only reopen if this is still a notification timeout popup
      if (notificationTimeouts[userName]) {
        marker.bindPopup(content, {
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          closeOnEscapeKey: false,
          keepInView: true,
          className: 'chat-popup'
        }).openPopup();
      }
    }
  }

  // Clear the temporary storage
  for (let userName in activeNotificationPopups) {
    delete activeNotificationPopups[userName];
  }
});

const markers = {};
const userMarkers = {}; // Track markers by username
const markerClusterGroup = L.markerClusterGroup();
map.addLayer(markerClusterGroup);

// Add notification input functionality
const createNotificationInput = () => {
  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.7);
    padding: 15px;
    border-radius: 10px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 1000;
    flex-wrap: nowrap;
    max-width: 90vw;
    width: auto;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type your message...';
  input.style.cssText = `
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 5px;
    flex: 1;
    min-width: 120px;
    font-size: 14px;
  `;

  const sendButton = document.createElement('button');
  sendButton.textContent = 'Send';
  sendButton.style.cssText = `
    padding: 8px 16px;
    background: #27ae60;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s;
  `;

  sendButton.addEventListener('mouseenter', () => {
    sendButton.style.background = '#229954';
  });

  sendButton.addEventListener('mouseleave', () => {
    sendButton.style.background = '#27ae60';
  });

  const gpsButton = document.createElement('button');
  gpsButton.textContent = 'GPS: OFF';
  gpsButton.style.cssText = `
    padding: 8px 12px;
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 14px;
    white-space: nowrap;
    flex-shrink: 0;
  `;

  const updateGpsButton = () => {
    if (gpsEnabled) {
      gpsButton.textContent = 'GPS: ON';
      gpsButton.style.background = '#28a745';
    } else {
      gpsButton.textContent = 'GPS: OFF';
      gpsButton.style.background = '#dc3545';
    }
  };

  gpsButton.addEventListener('click', () => {
    gpsEnabled = !gpsEnabled;
    updateGpsButton();

    // Update current location immediately based on GPS status
    if (actualLocation) {
      if (gpsEnabled) {
        currentLocation = { ...actualLocation };
        storedFakeLocation = null; // Clear stored fake location when GPS is turned on
      } else {
        // Generate new fake location when GPS is turned off
        storedFakeLocation = generateFakeLocation(actualLocation.latitude, actualLocation.longitude);
        currentLocation = storedFakeLocation;
      }

      // Send updated location with throttling when GPS is toggled
      if (shouldSendLocationUpdate(currentLocation)) {
        socket.emit("send-location", { 
          latitude: currentLocation.latitude, 
          longitude: currentLocation.longitude, 
          name: userName,
          gender: userGender // Include gender in the emitted data
        });

        // Update tracking variables
        lastSentLocation = { ...currentLocation };
        lastLocationSentTime = Date.now();
      }
    }
  });

  sendButton.addEventListener('click', () => {
    const message = input.value.trim();
    if (message && currentLocation && userName) {
      socket.emit('send-notification', {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        message: message,
        name: userName
      });
      input.value = '';
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendButton.click();
    }
  });

  inputContainer.appendChild(input);
  inputContainer.appendChild(sendButton);
  inputContainer.appendChild(gpsButton);
  document.body.appendChild(inputContainer);
};

// Create name input modal
const createNameInputModal = () => {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: rgba(255, 255, 255, 0.8);
    padding: 30px;
    border-radius: 15px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
    text-align: center;
    max-width: 400px;
    width: 90%;
  `;

  const title = document.createElement('h2');
  title.innerHTML = 'Welcome to <span style="color: #333;">M</span><span style="color: #4A90E2;">A</span><span style="color: #4A90E2;">i</span><span style="color: #333;">A</span> Social';
  title.style.cssText = `
    margin: 0 0 20px 0;
    color: #333;
    font-size: 24px;
    font-weight: bold;
  `;

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Please enter your username and select your gender:';
  subtitle.style.cssText = `
    margin: 0 0 20px 0;
    color: #666;
    font-size: 16px;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Username';
  input.style.cssText = `
    padding: 12px 16px;
    border: 2px solid #ddd;
    border-radius: 8px;
    width: 100%;
    font-size: 16px;
    margin-bottom: 20px;
    box-sizing: border-box;
  `;

  // Gender selection buttons
  const genderButtonsContainer = document.createElement('div');
  genderButtonsContainer.style.cssText = `
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-bottom: 20px;
  `;

  const maleButton = document.createElement('button');
  maleButton.textContent = '♂ Male';
  maleButton.style.cssText = `
    padding: 10px 20px;
    border: 2px solid #4A90E2;
    background-color: #ffffff;
    color: #4A90E2;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: background-color 0.3s, color 0.3s;
  `;
  maleButton.onmouseover = () => { maleButton.style.backgroundColor = '#4A90E2'; maleButton.style.color = 'white'; };
  maleButton.onmouseout = () => { if (userGender !== 'male') { maleButton.style.backgroundColor = '#ffffff'; maleButton.style.color = '#4A90E2'; } };

  const femaleButton = document.createElement('button');
  femaleButton.textContent = '♀ Female';
  femaleButton.style.cssText = `
    padding: 10px 20px;
    border: 2px solid #FF69B4;
    background-color: #ffffff;
    color: #FF69B4;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: background-color 0.3s, color 0.3s;
  `;
  femaleButton.onmouseover = () => { femaleButton.style.backgroundColor = '#FF69B4'; femaleButton.style.color = 'white'; };
  femaleButton.onmouseout = () => { if (userGender !== 'female') { femaleButton.style.backgroundColor = '#ffffff'; femaleButton.style.color = '#FF69B4'; } };


  maleButton.addEventListener('click', () => {
    userGender = 'male';
    maleButton.style.backgroundColor = '#4A90E2';
    maleButton.style.color = 'white';
    femaleButton.style.backgroundColor = '#ffffff';
    femaleButton.style.color = '#FF69B4';
  });

  femaleButton.addEventListener('click', () => {
    userGender = 'female';
    femaleButton.style.backgroundColor = '#FF69B4';
    femaleButton.style.color = 'white';
    maleButton.style.backgroundColor = '#ffffff';
    maleButton.style.color = '#4A90E2';
  });

  genderButtonsContainer.appendChild(maleButton);
  genderButtonsContainer.appendChild(femaleButton);


  const button = document.createElement('button');
  button.textContent = 'Continue';
  button.style.cssText = `
    padding: 12px 24px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    width: 100%;
  `;

  const handleNameSubmit = () => {
    const name = input.value.trim();
    if (name && userGender) {
      userName = name;
      socket.emit('set-name', { name: userName, gender: userGender }); // Pass gender to server

      // Send location immediately if we already have it
      if (currentLocation) {
        console.log(`Sending location after name set: ${currentLocation.latitude}, ${currentLocation.longitude}`);
        socket.emit("send-location", { 
          latitude: currentLocation.latitude, 
          longitude: currentLocation.longitude, 
          name: userName,
          gender: userGender // Include gender in the emitted data
        });

        lastSentLocation = { ...currentLocation };
        lastLocationSentTime = Date.now();
      }

      document.body.removeChild(modal);
      createNotificationInput();
    } else {
      if (!name) {
        input.style.borderColor = '#ff4444';
        input.placeholder = 'Username is required!';
      }
      if (!userGender) {
        // Optionally add visual feedback for gender selection
        alert('Please select your gender.');
      }
    }
  };

  button.addEventListener('click', handleNameSubmit);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    }
  });

  input.addEventListener('input', () => {
    input.style.borderColor = '#ddd';
    if (input.placeholder === 'Username is required!') {
      input.placeholder = 'Enter your username';
    }
  });

  modalContent.appendChild(title);
  modalContent.appendChild(subtitle);
  modalContent.appendChild(input);
  modalContent.appendChild(genderButtonsContainer); // Add gender buttons
  modalContent.appendChild(button);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Focus on input
  setTimeout(() => input.focus(), 100);
};

// Create name input modal on page load
createNameInputModal();

const addOffset = (latitude, longitude) => {
  const offset = 0.00001;
  const randomOffsetLat = (Math.random() - 0.5) * offset;
  const randomOffsetLng = (Math.random() - 0.5) * offset;
  return [latitude + randomOffsetLat, longitude + randomOffsetLng];
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;
  return distance;
};

// Function to check if location update should be sent
const shouldSendLocationUpdate = (newLocation) => {
  const now = Date.now();

  // Always send first location
  if (!lastSentLocation) {
    return true;
  }

  // Check time threshold
  if (now - lastLocationSentTime < MIN_UPDATE_INTERVAL) {
    return false;
  }

  // Check distance threshold
  const distance = calculateDistance(
    lastSentLocation.latitude,
    lastSentLocation.longitude,
    newLocation.latitude,
    newLocation.longitude
  );

  return distance >= MIN_DISTANCE_THRESHOLD;
};



// Store last notification messages for each user
const userLastMessages = {};
// Store user gender information
const userGenders = {};
// Store notification timeouts for auto-hide
const notificationTimeouts = {};
// Store recent messages for the message history box
const recentMessages = [];

// Create message history display box
const createMessageHistoryBox = () => {
  const messageBox = document.createElement('div');
  messageBox.id = 'messageHistoryBox';
  messageBox.style.cssText = `
    position: fixed;
    top: 50%;
    right: 20px;
    transform: translateY(-50%);
    width: 250px;
    max-height: 150px;
    background: rgba(255, 255, 255, 0.5);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 10px;
    padding: 15px;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 13px;
    color: #333;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    overflow-y: auto;
    display: none;
  `;

  document.body.appendChild(messageBox);
  return messageBox;
};

// Update message history display
const updateMessageHistory = () => {
  const messageBox = document.getElementById('messageHistoryBox');
  if (!messageBox) return;

  if (recentMessages.length === 0) {
    messageBox.style.display = 'none';
    return;
  }

  messageBox.style.display = 'block';

  // Show the 5 most recent messages
  const messagesToShow = recentMessages.slice(-10);

  messageBox.innerHTML = messagesToShow.map(msg => {
    const borderColor = userGenders[msg.name] === 'female' ? '#FF69B4' : '#007bff';
    return `<div style="margin-bottom: 8px; padding: 5px; background: rgba(255, 255, 255, 0.3); border-radius: 5px; border-left: 3px solid ${borderColor};">
      <strong style="color: #2c3e50;">${msg.name}:</strong> 
      <span style="color: #34495e;">${msg.message}</span>
    </div>`;
  }).join('');
};

// Initialize message history box
const messageHistoryBox = createMessageHistoryBox();

// Function to determine marker color based on gender
const getMarkerColor = (gender) => {
  if (gender === 'male') return '#2196F3'; // Blue
  if (gender === 'female') return '#FF69B4'; // Pink
  return '#9E9E9E'; // Default Grey
};

socket.on("receive-location", (data) => {
  const { id, latitude, longitude, message, name, gender } = data; // Added gender
  const userName = name || `User ${id}`;
  console.log(`Received location for ${userName}: ${latitude}, ${longitude}`);
  
  // Store gender information for this user
  if (gender) {
    userGenders[userName] = gender;
  }
  map.setView([latitude, longitude]);
  const [newLat, newLng] = addOffset(latitude, longitude);

  // If user already has a marker, just update position and exit
  if (userMarkers[userName]) {
    userMarkers[userName].setLatLng([newLat, newLng]);
    markers[id] = userMarkers[userName]; // Update the markers reference

    // If there's no active notification, ensure click handler is properly set
    if (!notificationTimeouts[userName]) {
      const marker = userMarkers[userName];
      marker.off('click'); // Remove any existing click handler
      marker.on('click', () => {
        if (userLastMessages[userName]) {
          const lastMessageContent = `<div style="text-align: center; min-width: 120px;">
            <b style="color: white; font-size: 14px;">${userName}</b><br/>
            <span style="color: #f8f9fa; font-size: 12px;">Last message:</span><br/>
            <span style="color: #34495e; font-size: 13px; background: #ecf0f1; padding: 4px 8px; border-radius: 12px; display: inline-block; margin-top: 4px;">${userLastMessages[userName]}</span>
          </div>`;
          marker.bindPopup(lastMessageContent, {
            closeButton: true,
            autoClose: true,
            closeOnClick: true,
            className: 'chat-popup'
          }).openPopup();
        } else {
          const noMessageContent = `<div style="text-align: center; min-width: 120px;">
            <b style="color: white; font-size: 14px;">${userName}</b><br/>
            <span style="color: #f8f9fa; font-size: 12px; font-style: italic;">No messages yet</span>
          </div>`;
          const noMsgPopupClassName = gender === 'female' ? 'chat-popup-female' : 'chat-popup';
          marker.bindPopup(noMessageContent, {
            closeButton: true,
            autoClose: true,
            closeOnClick: true,
            className: noMsgPopupClassName
          }).openPopup();
        }
      });
    }
    return; // Exit early since we only need to update position
  }

  // Remove all socket ID markers that belong to this username (cleanup)
  for (let socketId in markers) {
    if (markers[socketId] && markers[socketId] === userMarkers[userName]) {
      markerClusterGroup.removeLayer(markers[socketId]);
      delete markers[socketId];
    }
  }

  // Remove any existing marker for this specific socket ID
  if (markers[id]) {
    markerClusterGroup.removeLayer(markers[id]);
    delete markers[id];
  }

  // Create new marker for this user (only when no marker exists)
  const markerColor = getMarkerColor(gender); // Get color based on gender
  const newMarker = L.marker([newLat, newLng], { icon: L.divIcon({className: 'user-marker', html: `<div style="background-color: ${markerColor}; border-radius: 50%; width: 20px; height: 20px; border: 2px solid white; box-shadow: 0 0 0 2px ${markerColor};"></div>`, iconSize: [20, 20], iconAnchor: [10, 10]}) }).addTo(markerClusterGroup);

  // Add click event to show last chat message (for all users)
  const addClickHandler = (marker, userName) => {
    marker.off('click'); // Remove any existing click handler
    marker.on('click', () => {
      if (userLastMessages[userName]) {
        const lastMessageContent = `<div style="text-align: center; min-width: 100px;">
          <b style="color: #2c3e50; font-size: 12px;">${userName}</b><br/>
          <span style="color: #7f8c8d; font-size: 10px;">Last message:</span><br/>
          <span style="color: #34495e; font-size: 11px; background: #ecf0f1; padding: 3px 6px; border-radius: 8px; display: inline-block; margin-top: 2px;">${userLastMessages[userName]}</span>
        </div>`;
        const clickPopupClassName = gender === 'female' ? 'chat-popup-female' : 'chat-popup';
        marker.bindPopup(lastMessageContent, {
          closeButton: true,
          autoClose: true,
          closeOnClick: true,
          className: clickPopupClassName
        }).openPopup();
      } else {
        const noMessageContent = `<div style="text-align: center; min-width: 100px;">
          <b style="color: #2c3e50; font-size: 12px;">${userName}</b><br/>
          <span style="color: #95a5a6; font-size: 10px; font-style: italic;">No messages yet</span>
        </div>`;
        marker.bindPopup(noMessageContent, {
          closeButton: true,
          autoClose: true,
          closeOnClick: true,
          className: 'chat-popup'
        }).openPopup();
      }
    });
  };

  addClickHandler(newMarker, userName);

  // Update tracking objects - this should be the ONLY marker for this username
  markers[id] = newMarker;
  userMarkers[userName] = newMarker;
});

socket.on("receive-notification", (data) => {
  const { id, latitude, longitude, message, name, gender } = data;
  const userName = name || `User ${id}`;
  console.log(`Received chat message from ${userName}: ${message}`);

  // Store the last message for this user and gender info
  userLastMessages[userName] = message;
  if (gender) {
    userGenders[userName] = gender;
  }

  // Add to recent messages history
  recentMessages.push({
    name: userName,
    message: message,
    timestamp: Date.now()
  });

  // Keep only the last 10 messages to prevent memory issues
  if (recentMessages.length > 10) {
    recentMessages.shift();
  }

  // Update the message history display
  updateMessageHistory();

  // Get current zoom level to adjust popup styling
  const currentZoom = map.getZoom();
  const isZoomedOut = currentZoom <= 10; // Consider zoom level 10 and below as zoomed out

  // Enhanced popup content with zoom-aware styling
  const popupContent = `<div style="text-align: center; min-width: ${isZoomedOut ? '120px' : '100px'}; padding: ${isZoomedOut ? '6px' : '3px'};">
    <b style="color: white; font-size: ${isZoomedOut ? '14px' : '12px'}; font-weight: bold;">${userName}</b><br/>
    <span style="color: #34495e; font-size: ${isZoomedOut ? '13px' : '11px'}; background: #ecf0f1; padding: ${isZoomedOut ? '4px 8px' : '3px 6px'}; border-radius: 8px; display: inline-block; margin-top: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${message}</span>
  </div>`;

  // Use userMarkers to find the marker for this user
  if (userMarkers[userName]) {
    // Clear any existing timeout for this user
    if (notificationTimeouts[userName]) {
      clearTimeout(notificationTimeouts[userName]);
      delete notificationTimeouts[userName];
    }

    // Temporarily disable click handler to prevent interference
    userMarkers[userName].off('click');

    // Enhanced popup options for better visibility at all zoom levels with gender-based styling
    const popupClassName = data.gender === 'female' ? 'chat-popup-female' : 'chat-popup';
    const popupOptions = {
      closeButton: true,
      autoClose: false,
      closeOnClick: false,
      closeOnEscapeKey: false,
      keepInView: true,
      className: popupClassName,
      maxWidth: isZoomedOut ? 120 : 100,
      autoPan: true,
      autoPanPadding: [20, 20],
      offset: [0, isZoomedOut ? -10 : -6] // Adjust offset based on zoom level
    };

    // Show the chat message popup with enhanced styling that persists during zoom
    userMarkers[userName].bindPopup(popupContent, popupOptions).openPopup();

    // Prevent popup from closing during zoom operations and enhance visibility
    const popup = userMarkers[userName].getPopup();
    if (popup) {
      popup._closeOnMapZoom = false;

      // Add custom popup positioning for zoomed-out views
      if (isZoomedOut) {
        const popupElement = popup.getElement();
        if (popupElement) {
          popupElement.style.zIndex = '1000';
          popupElement.style.transform += ' scale(1.1)'; // Slightly larger for zoomed-out views
        }
      }
    }

    // Set timeout to close the popup after 8 seconds and restore click handler
    notificationTimeouts[userName] = setTimeout(() => {
      if (userMarkers[userName] && userMarkers[userName].isPopupOpen()) {
        userMarkers[userName].closePopup();
      }

      // Restore click handler after notification timeout
      if (userMarkers[userName]) {
        userMarkers[userName].on('click', () => {
          const clickZoom = map.getZoom();
          const isClickZoomedOut = clickZoom <= 10;

          if (userLastMessages[userName]) {
            const lastMessageContent = `<div style="text-align: center; min-width: ${isClickZoomedOut ? '120px' : '100px'};">
              <b style="color: white; font-size: ${isClickZoomedOut ? '14px' : '12px'};">${userName}</b><br/>
              <span style="color: #f8f9fa; font-size: ${isClickZoomedOut ? '11px' : '10px'};">Last message:</span><br/>
              <span style="color: #34495e; font-size: ${isClickZoomedOut ? '13px' : '11px'}; background: #ecf0f1; padding: ${isClickZoomedOut ? '4px 8px' : '3px 6px'}; border-radius: 8px; display: inline-block; margin-top: 2px;">${userLastMessages[userName]}</span>
            </div>`;
            const timeoutPopupClassName = userGenders[userName] === 'female' ? 'chat-popup-female' : 'chat-popup';
            userMarkers[userName].bindPopup(lastMessageContent, {
              closeButton: true,
              autoClose: true,
              closeOnClick: true,
              className: timeoutPopupClassName,
              maxWidth: isClickZoomedOut ? 120 : 100,
              offset: [0, isClickZoomedOut ? -10 : -6]
            }).openPopup();
          } else {
            const noMessageContent = `<div style="text-align: center; min-width: ${isClickZoomedOut ? '120px' : '100px'};">
              <b style="color: white; font-size: ${isClickZoomedOut ? '14px' : '12px'};">${userName}</b><br/>
              <span style="color: #f8f9fa; font-size: ${isClickZoomedOut ? '11px' : '10px'}; font-style: italic;">No messages yet</span>
            </div>`;
            const timeoutNoMsgPopupClassName = userGenders[userName] === 'female' ? 'chat-popup-female' : 'chat-popup';
            userMarkers[userName].bindPopup(noMessageContent, {
              closeButton: true,
              autoClose: true,
              closeOnClick: true,
              className: timeoutNoMsgPopupClassName,
              maxWidth: isClickZoomedOut ? 120 : 100,
              offset: [0, isClickZoomedOut ? -10 : -6]
            }).openPopup();
          }
        });
      }

      delete notificationTimeouts[userName];
    }, 8000);
  }
});

socket.on("user-disconnected", (id) => {
  console.log(`User disconnected: ${id}`);
  if (markers[id]) {
    // Find and remove from userMarkers as well
    for (let userName in userMarkers) {
      if (userMarkers[userName] === markers[id]) {
        delete userMarkers[userName];
        delete userLastMessages[userName]; // Clean up last messages
        if (notificationTimeouts[userName]) {
          clearTimeout(notificationTimeouts[userName]);
          delete notificationTimeouts[userName];
        }
        break;
      }
    }
    markerClusterGroup.removeLayer(markers[id]);
    delete markers[id];
  }
});

// Manual marker creation disabled
