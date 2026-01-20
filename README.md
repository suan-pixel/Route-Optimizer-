# Route Optimizer 🗺️

A mobile-responsive Progressive Web App (PWA) for optimizing multi-stop routes. Plan your trips efficiently by finding the optimal order of destinations to minimize travel time.

## 🚀 Features

### Start Location
- **Auto-detect** user's current location by default
- **Manual entry** with address autocomplete

### Destinations
- Add multiple destinations with the "+" button
- **Swipe-to-delete** gesture for easy removal on mobile
- **Drag-and-drop** to manually reorder destinations
- Support for both generic locations (e.g., "Walmart") and specific addresses

### Destination Locking
- **Tap the number** to lock/unlock a destination's position
- Locked destinations (shown in orange with underline) stay in place during optimization
- "Return to start" is locked by default

### Route Optimization
- Uses nearest-neighbor algorithm to find optimal route order
- For generic locations, finds the nearest branch
- Respects locked destination positions
- Displays optimized total travel time and time saved

### Export
- **"Open in Google Maps"** button launches the optimized route as a multi-stop trip

### Design
- **Mobile-responsive PWA** optimized for iOS and Android
- **Installable** as a home screen app
- Clean, intuitive interface
- Touch-friendly gestures
- Dark mode support

## 🌐 Live Demo

Visit: [https://suan-pixel.github.io/Route-Optimizer-/](https://suan-pixel.github.io/Route-Optimizer-/)

## 📱 Installation

### As a PWA (Recommended)
1. Open the app in your mobile browser
2. iOS: Tap Share → "Add to Home Screen"
3. Android: Tap Menu → "Install App" or "Add to Home Screen"

### Local Development
```bash
# Clone the repository
git clone https://github.com/suan-pixel/Route-Optimizer-.git
cd Route-Optimizer-

# Serve with any static server
npx serve .
# or
python -m http.server 8000
```

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Maps**: Leaflet.js + OpenStreetMap
- **Geocoding**: OpenStreetMap Nominatim API
- **Routing**: OSRM (Open Source Routing Machine)
- **PWA**: Service Worker for offline support

## 📁 Project Structure

```
Route-Optimizer-/
├── index.html      # Main HTML file
├── styles.css      # All styles
├── app.js          # Main application logic
├── sw.js           # Service Worker for PWA
├── manifest.json   # PWA manifest
├── icons/          # PWA icons
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   └── icon-512.png
└── README.md
```

## 🔧 GitHub Pages Deployment

This app is designed to be hosted on GitHub Pages:

1. Go to repository Settings → Pages
2. Set Source to "Deploy from a branch"
3. Select the `main` branch and `/ (root)` folder
4. Save and wait for deployment

## 📝 License

MIT License - feel free to use and modify for your own projects.

## 🙏 Credits

- OpenStreetMap contributors for map data
- OSRM for routing services
- Leaflet.js for the mapping library