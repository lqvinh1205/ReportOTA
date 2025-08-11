# JavaScript UI Demo with OTA API Integration

A modern, interactive JavaScript demonstration project showcasing various UI components and features built with vanilla JavaScript, HTML5, CSS3, and Node.js backend for OTA API integration.

## 🚀 Features

### Interactive Components
- **Expandable Cards**: Click to reveal more information with smooth animations
- **Dynamic Form**: Real-time validation and theme switching
- **Interactive Counter**: Increment, decrement, and reset with click tracking
- **Todo List**: Add, complete, and delete tasks with persistence
- **OTA API Integration**: Multiple methods to fetch data from BlueJay PMS

### OTA API Features
- **Node.js Server**: Backend server to handle authentication and API calls
- **Session Management**: Automatic login and cookie handling
- **CORS Bypass**: Server-side requests to avoid browser CORS issues
- **Multiple Fetch Methods**: Direct fetch, proxy, XHR, and server-side options
- **Real-time Status**: Live updates on API call progress

### Modern UI/UX
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **Theme Support**: Light, dark, and blue themes with instant switching
- **Smooth Animations**: CSS transitions and JavaScript-powered animations
- **Accessibility**: Keyboard navigation and screen reader friendly

## 📁 Project Structure

```
javascript-ui-demo/
├── index.html          # Main HTML file
├── styles.css          # CSS styles with CSS variables for theming
├── script.js           # Frontend JavaScript functionality
├── server.js           # Node.js backend server for OTA API
├── package.json        # Project configuration and dependencies
├── start.sh            # Script to start both frontend and backend
├── server-only.sh      # Script to start only the Node.js server
└── README.md          # Project documentation
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Quick Start (Recommended)
```bash
# Navigate to project directory
cd "/home/mor/Desktop/Report OTA"

# Start both frontend and backend servers
./start.sh
```

This will:
1. Install Node.js dependencies automatically
2. Start Node.js server on port 3001
3. Start frontend server on port 3000
4. Open browser automatically

### Manual Setup

#### 1. Install Dependencies
```bash
npm install
```

#### 2. Start Node.js Server (Backend)
```bash
# Option 1: Production mode
npm run server

# Option 2: Development mode with auto-restart
npm run server:dev

# Option 3: Using shell script
./server-only.sh
```

#### 3. Start Frontend Server
```bash
# Option 1: Live reload development server
npm run dev

# Option 2: Simple HTTP server
npm run start
```

### Alternative: Manual Dependencies Installation
```bash
npm install express axios cors nodemon
```

## 🌐 API Endpoints

### Node.js Server (Port 3001)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Check server health and session status |
| POST | `/api/login` | Login to OTA system |
| GET | `/api/report` | Fetch report data (requires login) |
| POST | `/api/login-and-fetch` | Combined login + fetch operation |

### Usage Examples

```bash
# Check server health
curl http://localhost:3001/api/health

# Login to OTA system
curl -X POST http://localhost:3001/api/login

# Fetch report (after login)
curl http://localhost:3001/api/report

# Combined operation (recommended)
curl -X POST http://localhost:3001/api/login-and-fetch
```

## 📱 Frontend Usage

### OTA API Testing
1. **Check Server Health** - Verify Node.js server is running
2. **Fetch via Node.js Server** - Use backend to handle authentication and CORS
3. **Direct Fetch Methods** - Try browser-based approaches (may have CORS issues)

### Other Interactive Features
- **Interactive Cards**: Click "Learn More" on any card
- **Dynamic Form**: Real-time validation and theme switching  
- **Counter Component**: Increment/decrement with tracking
- **Todo List**: Full CRUD operations with persistence

## 🔧 Development

### Available Scripts
- `npm run server` - Start Node.js server
- `npm run server:dev` - Start server with auto-reload
- `npm run dev` - Start frontend with live reload
- `npm run start` - Start frontend HTTP server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Configuration

#### OTA API Parameters
Edit in `server.js`:
```javascript
const params = {
    TypeSearchDate: 0,
    FromDate: '08/08/2025',
    ToDate: '10/08/2025',
    RoomType: 10559,
    txtEmail: 'your-email@example.com',
    txtPassword: 'your-password'
    // ... other parameters
};
```

#### Server Configuration
- **Backend Port**: 3001 (configurable in `server.js`)
- **Frontend Port**: 3000 (configurable in npm scripts)
- **CORS**: Enabled for all origins in development

## 🚀 Deployment

### Production Deployment
1. Set environment variables for production
2. Use process manager like PM2
3. Configure reverse proxy (nginx)
4. Enable HTTPS

```bash
# Example with PM2
npm install -g pm2
pm2 start server.js --name "ota-api-server"
```

## 🐛 Troubleshooting

### Common Issues

**1. Server not starting**
```bash
# Check if port 3001 is available
lsof -i :3001

# Kill process using the port
kill -9 <PID>
```

**2. CORS errors**
- Use the Node.js server option instead of direct browser calls
- Server handles CORS and authentication automatically

**3. Authentication failures**
- Check credentials in `server.js`
- Verify BlueJay PMS system is accessible
- Check server logs for detailed error messages

**4. Dependencies issues**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## 📊 Monitoring & Logging

The Node.js server includes detailed logging:
- 🔐 Login process steps
- 📄 Session cookie management  
- 🔍 Form field extraction
- ✅ Success responses
- ❌ Error details with status codes

Check console output for real-time debugging information.

## 🔮 Future Enhancements

- [ ] Database integration for data persistence
- [ ] User authentication and authorization
- [ ] API rate limiting and caching
- [ ] Docker containerization
- [ ] Automated testing suite
- [ ] Dashboard for multiple OTA systems
- [ ] Data export formats (CSV, Excel, PDF)
- [ ] Scheduled report generation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b new-feature`
3. Commit your changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the package.json file for details.

---

**Built with ❤️ using JavaScript, Node.js, Express, and modern web technologies**

## 🚀 Features

### Interactive Components
- **Expandable Cards**: Click to reveal more information with smooth animations
- **Dynamic Form**: Real-time validation and theme switching
- **Interactive Counter**: Increment, decrement, and reset with click tracking
- **Todo List**: Add, complete, and delete tasks with persistence

### Modern UI/UX
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **Theme Support**: Light, dark, and blue themes with instant switching
- **Smooth Animations**: CSS transitions and JavaScript-powered animations
- **Accessibility**: Keyboard navigation and screen reader friendly

### Technical Features
- **Vanilla JavaScript**: No frameworks or libraries required
- **ES6+ Features**: Modern JavaScript syntax and features
- **Local Storage**: Theme preferences and data persistence
- **Performance Monitoring**: Built-in performance tracking
- **Modular Code**: Clean, organized, and maintainable code structure

## 📁 Project Structure

```
javascript-ui-demo/
├── index.html          # Main HTML file
├── styles.css          # CSS styles with CSS variables for theming
├── script.js           # JavaScript functionality
├── package.json        # Project configuration and dependencies
└── README.md          # Project documentation
```

## 🛠️ Installation & Setup

### Option 1: Simple File Opening
1. Download or clone the project files
2. Open `index.html` in your web browser
3. Start exploring the interactive features!

### Option 2: Local Development Server (Recommended)
1. Install Node.js if you haven't already
2. Navigate to the project directory:
   ```bash
   cd /path/to/javascript-ui-demo
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser to `http://localhost:3000`

### Option 3: HTTP Server
```bash
npm run start
```

## 📱 Usage

### Interactive Cards
- Click "Learn More" on any card to expand and see additional details
- Cards feature hover effects and smooth animations

### Dynamic Form
- Fill out the form with real-time validation
- Switch themes using the dropdown
- Submit to see formatted JSON output

### Counter Component
- Use +/- buttons to increment/decrement
- Reset button returns counter to zero
- Tracks total number of clicks

### Todo List
- Add new tasks by typing and pressing Enter or clicking "Add"
- Mark tasks as complete/incomplete
- Delete tasks you no longer need
- View real-time statistics

### Theme Switching
- Choose between Light, Dark, and Blue themes
- Preferences are automatically saved to localStorage
- Instant visual feedback when switching themes

## 🎨 Customization

### Adding New Themes
1. Define new CSS variables in `styles.css`:
   ```css
   [data-theme="your-theme"] {
     --primary-color: #your-color;
     --background-color: #your-bg;
     /* ... other variables */
   }
   ```
2. Add the theme option to the select dropdown in `index.html`
3. The theme system will automatically apply your new theme

### Extending Components
The code is modular and easy to extend:
- Add new card types by following the existing card structure
- Create additional form fields with validation
- Extend the todo list with categories, due dates, etc.

## 🔧 Development

### Available Scripts
- `npm run start` - Start HTTP server on port 3000
- `npm run dev` - Start live-reload development server
- `npm run lint` - Run ESLint on JavaScript files
- `npm run format` - Format code with Prettier

### Code Quality
- Modern ES6+ JavaScript
- Semantic HTML5 markup
- CSS Grid and Flexbox for layouts
- Responsive design principles
- Accessibility best practices

## 🌟 Features Showcase

### CSS Features
- CSS Custom Properties (Variables) for theming
- CSS Grid and Flexbox layouts
- Smooth transitions and animations
- Responsive breakpoints
- Modern typography with Google Fonts

### JavaScript Features
- Event delegation and handling
- Local storage for persistence
- Form validation and data processing
- Dynamic DOM manipulation
- Performance monitoring
- Modular class-based architecture

## 🚀 Performance

- **Vanilla JavaScript**: No framework overhead
- **Optimized CSS**: Efficient selectors and minimal repaints
- **Lazy Loading**: Images and content loaded as needed
- **Local Storage**: Efficient data persistence
- **Performance Monitoring**: Built-in performance tracking

## 📱 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b new-feature`
3. Commit your changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the package.json file for details.

## 🎯 Learning Objectives

This project demonstrates:
- Modern JavaScript best practices
- Responsive web design principles
- Interactive UI component development
- State management without frameworks
- Performance optimization techniques
- Accessibility considerations
- Progressive enhancement

## 🔮 Future Enhancements

- [ ] PWA (Progressive Web App) features
- [ ] Data export/import functionality
- [ ] Keyboard shortcuts
- [ ] More theme options
- [ ] Advanced animations
- [ ] Component testing
- [ ] TypeScript migration
- [ ] Module bundling

---

**Built with ❤️ using vanilla JavaScript, HTML5, and CSS3**

https://id.bluejaypms.com/app/Reservation?TypeSearchDate=3&FromDate=11%2F08%2F2025&ToDate=11%2F08%2F2025&RoomType=10559&RoomDetail=&SourceType=&Source=&Status=1%2C0%2C3%2C4%2C2&Search=&IsExtensionFilder=true&p=1&txtEmail=ota.eraapartment4%40gmail.com&txtPassword=123456
https://id.bluejaypms.com/app/Reservation?TypeSearchDate=3&FromDate=11%2F08%2F2025&ToDate=11%2F08%2F2025&RoomType=10559&RoomDetail=&SourceType=&Source=&Status=1%2C0%2C3%2C4%2C2&Seach=&IsExtensionFilder=true&p=1&txtEmail=ota.eraapartment4%40gmail.com&txtPassword=123456# ReportOTA
