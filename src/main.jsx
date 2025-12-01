import React from 'react'
import ReactDOM from 'react-dom/client'
// Use a clean App implementation while the original file is corrupted
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
