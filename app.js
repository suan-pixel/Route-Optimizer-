/**
 * Route Optimizer - Main Application
 * A PWA for optimizing multi-stop routes
 */

// ===================================
// State Management
// ===================================

const state = {
    startLocation: null,
    destinations: [],
    returnToStart: true,
    map: null,
    routeLayer: null,
    markersLayer: null,
    isOptimizing: false
};

// Destination counter for unique IDs
let destinationCounter = 0;

// ===================================
// DOM Elements
// ===================================

const elements = {
    startLocationInput: document.getElementById('startLocation'),
    startSuggestions: document.getElementById('startSuggestions'),
    startLocationStatus: document.getElementById('startLocationStatus'),
    detectLocationBtn: document.getElementById('detectLocationBtn'),
    addDestinationBtn: document.getElementById('addDestinationBtn'),
    destinationsList: document.getElementById('destinationsList'),
    returnToStartCheckbox: document.getElementById('returnToStart'),
    optimizeBtn: document.getElementById('optimizeBtn'),
    resultsSection: document.getElementById('resultsSection'),
    optimizedTime: document.getElementById('optimizedTime'),
    timeSaved: document.getElementById('timeSaved'),
    totalDistance: document.getElementById('totalDistance'),
    optimizedOrderList: document.getElementById('optimizedOrderList'),
    openInMapsBtn: document.getElementById('openInMapsBtn'),
    toast: document.getElementById('toast')
};

// ===================================
// Initialization
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Add event listeners
    elements.detectLocationBtn.addEventListener('click', detectUserLocation);
    elements.addDestinationBtn.addEventListener('click', addDestination);
    elements.returnToStartCheckbox.addEventListener('change', handleReturnToStartChange);
    elements.optimizeBtn.addEventListener('click', optimizeRoute);
    elements.openInMapsBtn.addEventListener('click', openInGoogleMaps);
    
    // Start location input with autocomplete
    setupAutocomplete(elements.startLocationInput, elements.startSuggestions, (location) => {
        state.startLocation = location;
        updateOptimizeButton();
        showToast('Start location set', 'success');
    });
    
    // Add initial destination field
    addDestination();
    
    // Try to auto-detect location on load
    detectUserLocation();
}

// ===================================
// Geolocation
// ===================================

function detectUserLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
    }
    
    elements.startLocationStatus.textContent = 'Detecting location...';
    elements.startLocationStatus.className = 'location-status';
    elements.detectLocationBtn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            try {
                // Reverse geocode to get address
                const address = await reverseGeocode(latitude, longitude);
                
                state.startLocation = {
                    address: address,
                    lat: latitude,
                    lng: longitude
                };
                
                elements.startLocationInput.value = address;
                elements.startLocationStatus.textContent = '✓ Location detected';
                elements.startLocationStatus.className = 'location-status success';
                updateOptimizeButton();
            } catch (error) {
                elements.startLocationStatus.textContent = 'Could not get address. Please enter manually.';
                elements.startLocationStatus.className = 'location-status error';
            }
            
            elements.detectLocationBtn.disabled = false;
        },
        (error) => {
            let message = 'Could not detect location';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enter manually.';
            }
            elements.startLocationStatus.textContent = message;
            elements.startLocationStatus.className = 'location-status error';
            elements.detectLocationBtn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ===================================
// Geocoding (using OpenStreetMap Nominatim)
// ===================================

async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
        );
        if (!response.ok) {
            throw new Error('Geocoding request failed');
        }
        const data = await response.json();
        return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

async function geocode(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`
        );
        if (!response.ok) {
            throw new Error('Geocoding request failed');
        }
        return await response.json();
    } catch (error) {
        console.error('Geocoding error:', error);
        return [];
    }
}

async function searchLocation(query, nearLat = null, nearLng = null) {
    try {
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
        
        // If we have a reference point, use bounded search to prefer nearby results
        if (nearLat && nearLng) {
            const viewbox = `${nearLng - 0.5},${nearLat - 0.5},${nearLng + 0.5},${nearLat + 0.5}`;
            url += `&viewbox=${viewbox}&bounded=0`;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Location search request failed');
        }
        return await response.json();
    } catch (error) {
        console.error('Location search error:', error);
        return [];
    }
}

// ===================================
// Autocomplete
// ===================================

let autocompleteTimeout = null;

function setupAutocomplete(inputElement, suggestionsElement, onSelect) {
    inputElement.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Clear previous timeout
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }
        
        if (query.length < 3) {
            hideSuggestions(suggestionsElement);
            return;
        }
        
        // Debounce API calls
        autocompleteTimeout = setTimeout(async () => {
            try {
                const results = await geocode(query);
                showSuggestions(suggestionsElement, results, (result) => {
                    inputElement.value = result.display_name;
                    onSelect({
                        address: result.display_name,
                        lat: parseFloat(result.lat),
                        lng: parseFloat(result.lon)
                    });
                    hideSuggestions(suggestionsElement);
                });
            } catch (error) {
                console.error('Autocomplete error:', error);
            }
        }, 300);
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!inputElement.contains(e.target) && !suggestionsElement.contains(e.target)) {
            hideSuggestions(suggestionsElement);
        }
    });
}

function showSuggestions(container, results, onSelect) {
    container.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<div class="suggestion-item">No results found</div>';
        container.classList.add('active');
        return;
    }
    
    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = result.display_name;
        item.addEventListener('click', () => onSelect(result));
        container.appendChild(item);
    });
    
    container.classList.add('active');
}

function hideSuggestions(container) {
    container.classList.remove('active');
}

// ===================================
// Destination Management
// ===================================

function addDestination() {
    const id = ++destinationCounter;
    
    const destination = {
        id: id,
        address: '',
        location: null,
        locked: false
    };
    
    state.destinations.push(destination);
    renderDestinations();
    updateOptimizeButton();
    
    // Focus the new input
    setTimeout(() => {
        const newInput = document.querySelector(`[data-destination-id="${id}"] .destination-input`);
        if (newInput) newInput.focus();
    }, 100);
}

function removeDestination(id) {
    state.destinations = state.destinations.filter(d => d.id !== id);
    renderDestinations();
    updateOptimizeButton();
}

function toggleDestinationLock(id) {
    const destination = state.destinations.find(d => d.id === id);
    if (destination) {
        destination.locked = !destination.locked;
        renderDestinations();
        showToast(destination.locked ? 'Destination locked' : 'Destination unlocked', 'success');
    }
}

function renderDestinations() {
    elements.destinationsList.innerHTML = '';
    
    if (state.destinations.length === 0) {
        elements.destinationsList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📍</div>
                <p>Click "+ Add" to add destinations</p>
            </div>
        `;
        return;
    }
    
    state.destinations.forEach((dest, index) => {
        const item = createDestinationElement(dest, index + 1);
        elements.destinationsList.appendChild(item);
    });
    
    // Initialize drag and drop
    initializeDragAndDrop();
}

function createDestinationElement(destination, number) {
    const item = document.createElement('div');
    item.className = 'destination-item';
    item.dataset.destinationId = destination.id;
    item.draggable = true;
    
    item.innerHTML = `
        <div class="destination-number ${destination.locked ? 'locked' : ''}" 
             title="Click to ${destination.locked ? 'unlock' : 'lock'} position">
            ${number}
        </div>
        <div class="destination-input-wrapper">
            <input type="text" 
                   class="destination-input" 
                   placeholder="Enter destination (e.g., Walmart, 123 Main St...)"
                   value="${destination.address}"
                   autocomplete="off">
            <div class="suggestions-dropdown"></div>
        </div>
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <button class="delete-btn" title="Remove destination">×</button>
    `;
    
    // Lock/unlock on number click
    const numberEl = item.querySelector('.destination-number');
    numberEl.addEventListener('click', () => toggleDestinationLock(destination.id));
    
    // Delete button
    const deleteBtn = item.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => removeDestination(destination.id));
    
    // Input autocomplete
    const input = item.querySelector('.destination-input');
    const suggestions = item.querySelector('.suggestions-dropdown');
    
    setupAutocomplete(input, suggestions, (location) => {
        destination.address = location.address;
        destination.location = location;
        updateOptimizeButton();
    });
    
    // Update address on blur if no autocomplete selection
    input.addEventListener('blur', () => {
        if (input.value !== destination.address) {
            destination.address = input.value;
            destination.location = null; // Will be geocoded during optimization
        }
    });
    
    // Touch swipe to delete
    setupSwipeToDelete(item, () => removeDestination(destination.id));
    
    return item;
}

// ===================================
// Drag and Drop
// ===================================

function initializeDragAndDrop() {
    const items = elements.destinationsList.querySelectorAll('.destination-item');
    
    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.destinationId);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.destination-item').forEach(item => {
        item.classList.remove('drag-over');
    });
    draggedItem = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    if (draggedItem === this) return;
    
    const draggedId = parseInt(draggedItem.dataset.destinationId);
    const targetId = parseInt(this.dataset.destinationId);
    
    const draggedIndex = state.destinations.findIndex(d => d.id === draggedId);
    const targetIndex = state.destinations.findIndex(d => d.id === targetId);
    
    // Swap positions
    const [removed] = state.destinations.splice(draggedIndex, 1);
    state.destinations.splice(targetIndex, 0, removed);
    
    renderDestinations();
}

// ===================================
// Swipe to Delete (Mobile)
// ===================================

function setupSwipeToDelete(element, onDelete) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    
    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        element.classList.add('swiping');
    }, { passive: true });
    
    element.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        currentX = e.touches[0].clientX;
        const diff = startX - currentX;
        
        if (diff > 0) {
            const translateX = Math.min(diff, 80);
            element.style.transform = `translateX(-${translateX}px)`;
        }
    }, { passive: true });
    
    element.addEventListener('touchend', () => {
        isDragging = false;
        element.classList.remove('swiping');
        
        const diff = startX - currentX;
        
        if (diff > 60) {
            // Swipe threshold reached - delete
            element.style.transform = 'translateX(-100%)';
            element.style.opacity = '0';
            setTimeout(onDelete, 200);
        } else {
            // Reset position
            element.style.transform = '';
        }
    });
}

// ===================================
// Return to Start
// ===================================

function handleReturnToStartChange(e) {
    state.returnToStart = e.target.checked;
}

// ===================================
// Update Optimize Button
// ===================================

function updateOptimizeButton() {
    const hasStart = state.startLocation !== null;
    const hasValidDestinations = state.destinations.some(d => d.address.trim() !== '');
    
    elements.optimizeBtn.disabled = !hasStart || !hasValidDestinations || state.isOptimizing;
}

// ===================================
// Route Optimization
// ===================================

async function optimizeRoute() {
    if (state.isOptimizing) return;
    
    state.isOptimizing = true;
    elements.optimizeBtn.querySelector('.btn-text').style.display = 'none';
    elements.optimizeBtn.querySelector('.btn-loading').style.display = 'flex';
    elements.optimizeBtn.disabled = true;
    
    try {
        // Filter destinations with addresses
        const validDestinations = state.destinations.filter(d => d.address.trim() !== '');
        
        if (validDestinations.length === 0) {
            throw new Error('Please add at least one destination');
        }
        
        // Geocode destinations that don't have coordinates
        showToast('Finding locations...', 'success');
        
        for (const dest of validDestinations) {
            if (!dest.location) {
                const results = await searchLocation(
                    dest.address,
                    state.startLocation.lat,
                    state.startLocation.lng
                );
                
                if (results.length > 0) {
                    dest.location = {
                        address: results[0].display_name,
                        lat: parseFloat(results[0].lat),
                        lng: parseFloat(results[0].lon)
                    };
                } else {
                    throw new Error(`Could not find location: ${dest.address}`);
                }
            }
        }
        
        // Separate locked and unlocked destinations
        const lockedDests = validDestinations.filter(d => d.locked);
        const unlockedDests = validDestinations.filter(d => !d.locked);
        
        // Calculate distance matrix for unlocked destinations
        showToast('Calculating optimal route...', 'success');
        
        // Get all waypoints including locked ones
        const allWaypoints = [
            state.startLocation,
            ...validDestinations.map(d => d.location),
            ...(state.returnToStart ? [state.startLocation] : [])
        ];
        
        // Calculate original (unoptimized) route
        const originalRoute = await calculateRoute(allWaypoints);
        
        // Optimize unlocked destinations
        let optimizedOrder;
        if (unlockedDests.length > 1) {
            optimizedOrder = await findOptimalOrder(
                state.startLocation,
                validDestinations,
                state.returnToStart
            );
        } else {
            optimizedOrder = validDestinations;
        }
        
        // Calculate optimized route
        const optimizedWaypoints = [
            state.startLocation,
            ...optimizedOrder.map(d => d.location),
            ...(state.returnToStart ? [state.startLocation] : [])
        ];
        
        const optimizedRoute = await calculateRoute(optimizedWaypoints);
        
        // Display results
        displayResults(optimizedOrder, optimizedRoute, originalRoute);
        
    } catch (error) {
        console.error('Optimization error:', error);
        showToast(error.message || 'Optimization failed', 'error');
    } finally {
        state.isOptimizing = false;
        elements.optimizeBtn.querySelector('.btn-text').style.display = 'inline';
        elements.optimizeBtn.querySelector('.btn-loading').style.display = 'none';
        elements.optimizeBtn.disabled = false;
    }
}

// ===================================
// Optimal Order Algorithm (TSP-like)
// ===================================

async function findOptimalOrder(start, destinations, returnToStart) {
    const locked = destinations.filter(d => d.locked);
    const unlocked = destinations.filter(d => !d.locked);
    
    if (unlocked.length <= 1) {
        return destinations;
    }
    
    // Use nearest neighbor heuristic for unlocked destinations
    // This is a simple but effective approach for small numbers of stops
    
    const result = [];
    const unvisited = [...unlocked];
    let current = start;
    
    // Build the route considering locked positions
    for (let i = 0; i < destinations.length; i++) {
        const originalDest = destinations[i];
        
        if (originalDest.locked) {
            // Keep locked destinations in their position
            result.push(originalDest);
            current = originalDest.location;
            // Remove from unvisited if it was there
            const idx = unvisited.findIndex(d => d.id === originalDest.id);
            if (idx !== -1) unvisited.splice(idx, 1);
        } else if (unvisited.length > 0) {
            // Find nearest unvisited destination
            let nearestIdx = 0;
            let nearestDist = Infinity;
            
            for (let j = 0; j < unvisited.length; j++) {
                const dist = calculateDistance(
                    current.lat, current.lng,
                    unvisited[j].location.lat, unvisited[j].location.lng
                );
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = j;
                }
            }
            
            const nearest = unvisited.splice(nearestIdx, 1)[0];
            result.push(nearest);
            current = nearest.location;
        }
    }
    
    // Add any remaining unvisited destinations
    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        
        for (let j = 0; j < unvisited.length; j++) {
            const dist = calculateDistance(
                current.lat, current.lng,
                unvisited[j].location.lat, unvisited[j].location.lng
            );
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = j;
            }
        }
        
        const nearest = unvisited.splice(nearestIdx, 1)[0];
        result.push(nearest);
        current = nearest.location;
    }
    
    return result;
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * Math.PI / 180;
}

// ===================================
// Route Calculation (OSRM)
// ===================================

async function calculateRoute(waypoints) {
    try {
        // Use OSRM for routing
        const coords = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
        
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
        );
        
        if (!response.ok) {
            throw new Error('Route calculation request failed');
        }
        
        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('Could not calculate route');
        }
        
        return {
            duration: data.routes[0].duration, // seconds
            distance: data.routes[0].distance, // meters
            geometry: data.routes[0].geometry
        };
    } catch (error) {
        console.error('Route calculation error:', error);
        throw new Error('Could not calculate route. Please check your internet connection.');
    }
}

// ===================================
// Display Results
// ===================================

function displayResults(optimizedOrder, optimizedRoute, originalRoute) {
    // Show results section
    elements.resultsSection.style.display = 'block';
    
    // Calculate time saved
    const timeSaved = Math.max(0, originalRoute.duration - optimizedRoute.duration);
    
    // Update stats
    elements.optimizedTime.textContent = formatDuration(optimizedRoute.duration);
    elements.timeSaved.textContent = formatDuration(timeSaved);
    elements.totalDistance.textContent = formatDistance(optimizedRoute.distance);
    
    // Update optimized order list
    elements.optimizedOrderList.innerHTML = '';
    
    // Add start location
    const startItem = document.createElement('li');
    startItem.innerHTML = `<strong>Start:</strong> ${truncateAddress(state.startLocation.address)}`;
    elements.optimizedOrderList.appendChild(startItem);
    
    // Add destinations
    optimizedOrder.forEach((dest, index) => {
        const li = document.createElement('li');
        li.className = dest.locked ? 'locked' : '';
        li.textContent = truncateAddress(dest.address || dest.location.address);
        elements.optimizedOrderList.appendChild(li);
    });
    
    // Add return to start if enabled
    if (state.returnToStart) {
        const returnItem = document.createElement('li');
        returnItem.className = 'locked';
        returnItem.innerHTML = `<strong>Return:</strong> ${truncateAddress(state.startLocation.address)}`;
        elements.optimizedOrderList.appendChild(returnItem);
    }
    
    // Update map
    displayMap(optimizedOrder, optimizedRoute.geometry);
    
    // Store for Google Maps export
    state.optimizedOrder = optimizedOrder;
    
    // Scroll to results
    elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
    
    showToast('Route optimized!', 'success');
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
}

function formatDistance(meters) {
    const miles = meters / 1609.344;
    if (miles < 0.1) {
        const feet = meters * 3.28084;
        return `${Math.round(feet)} ft`;
    }
    return `${miles.toFixed(1)} mi`;
}

function truncateAddress(address) {
    if (address.length > 50) {
        return address.substring(0, 47) + '...';
    }
    return address;
}

// ===================================
// Map Display
// ===================================

function displayMap(destinations, geometry) {
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.warn('Leaflet library not loaded. Map display skipped.');
        document.getElementById('map').innerHTML = '<div class="map-loading-message">📍 Map loading... If this persists, please check your internet connection.</div>';
        return;
    }
    
    // Initialize map if not exists
    if (!state.map) {
        state.map = L.map('map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(state.map);
        
        state.routeLayer = L.layerGroup().addTo(state.map);
        state.markersLayer = L.layerGroup().addTo(state.map);
    }
    
    // Clear existing layers
    state.routeLayer.clearLayers();
    state.markersLayer.clearLayers();
    
    // Add route line
    if (geometry && geometry.coordinates) {
        const routeLine = L.geoJSON(geometry, {
            style: {
                color: '#4A90D9',
                weight: 4,
                opacity: 0.8
            }
        });
        state.routeLayer.addLayer(routeLine);
    }
    
    // Add markers
    const allPoints = [
        { ...state.startLocation, label: 'Start', isStart: true },
        ...destinations.map((d, i) => ({
            ...d.location,
            label: String(i + 1),
            locked: d.locked
        })),
        ...(state.returnToStart ? [{ ...state.startLocation, label: 'End', isEnd: true }] : [])
    ];
    
    const bounds = L.latLngBounds();
    
    allPoints.forEach(point => {
        const color = point.isStart || point.isEnd ? '#4A90D9' : 
                     point.locked ? '#F39C12' : '#27AE60';
        
        const marker = L.circleMarker([point.lat, point.lng], {
            radius: 12,
            fillColor: color,
            color: '#fff',
            weight: 2,
            fillOpacity: 1
        });
        
        marker.bindTooltip(point.label, {
            permanent: true,
            direction: 'center',
            className: 'marker-label'
        });
        
        state.markersLayer.addLayer(marker);
        bounds.extend([point.lat, point.lng]);
    });
    
    // Fit map to bounds
    state.map.fitBounds(bounds, { padding: [30, 30] });
}

// ===================================
// Google Maps Export
// ===================================

function openInGoogleMaps() {
    if (!state.optimizedOrder || state.optimizedOrder.length === 0) {
        showToast('Please optimize route first', 'error');
        return;
    }
    
    // Build Google Maps URL
    // Format: https://www.google.com/maps/dir/origin/waypoint1/waypoint2/.../destination
    
    const origin = `${state.startLocation.lat},${state.startLocation.lng}`;
    const waypoints = state.optimizedOrder.map(d => 
        `${d.location.lat},${d.location.lng}`
    );
    
    let destination = waypoints[waypoints.length - 1];
    if (state.returnToStart) {
        destination = origin;
    }
    
    // Google Maps URL structure
    let url = `https://www.google.com/maps/dir/${origin}`;
    
    // Add waypoints (all except the last if not returning to start)
    const waypointCount = state.returnToStart ? waypoints.length : waypoints.length - 1;
    for (let i = 0; i < waypointCount; i++) {
        url += `/${waypoints[i]}`;
    }
    
    url += `/${destination}`;
    
    // Open in new tab
    window.open(url, '_blank');
}

// ===================================
// Toast Notifications
// ===================================

let toastTimeout = null;

function showToast(message, type = 'info') {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type}`;
    elements.toast.classList.add('show');
    
    toastTimeout = setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}
