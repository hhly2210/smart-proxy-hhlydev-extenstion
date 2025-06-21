// Utility functions for Smart Proxy Switcher

/**
 * Enhanced message sending with error handling
 * @param {object} message - The message to send
 * @param {function} callback - The callback function (optional)
 * @returns {Promise} A promise that resolves with the response
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          console.error("Chrome runtime error:", chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      console.error("Exception sending message:", err);
      reject(err);
    }
  });
}

/**
 * Safe storage read with error handling
 * @param {object} keys - The keys to read
 * @returns {Promise} A promise that resolves with the data
 */
function readStorage(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(keys, (data) => {
        if (chrome.runtime.lastError) {
          console.error("Storage read error:", chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve(data);
        }
      });
    } catch (err) {
      console.error("Exception reading storage:", err);
      reject(err);
    }
  });
}

/**
 * Safe storage write with error handling
 * @param {object} data - The data to write
 * @returns {Promise} A promise that resolves when the write is complete
 */
function writeStorage(data) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          console.error("Storage write error:", chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error("Exception writing storage:", err);
      reject(err);
    }
  });
}

/**
 * Shows a notification message in the UI
 * @param {string} message - The message to show
 * @param {string} type - The type of message (success, warning, error)
 * @param {number} duration - How long to show the message in ms (0 for no auto-hide)
 * @returns {HTMLElement} The message element that was created
 */
function showNotification(message, type = "success", duration = 2000) {
  // Create the message element
  const messageDiv = document.createElement("div");
  messageDiv.textContent = message;
  messageDiv.className = "notification " + type;
  // Set styles based on type
  let bgColor = "#4CAF50"; // success (green)
  if (type === "error") {
    bgColor = "#f44336"; // error (red)
  } else if (type === "warning") {
    bgColor = "#ff9800"; // warning (orange)
  } else if (type === "info") {
    bgColor = "#2196F3"; // info (blue)
  }

  messageDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background-color: ${bgColor};
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    font-weight: bold;
    z-index: 1000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  `;

  document.body.appendChild(messageDiv);
  // Add close button for warnings, errors, and info messages
  if (
    type === "warning" ||
    type === "error" ||
    type === "info" ||
    duration === 0
  ) {
    const closeBtn = document.createElement("span");
    closeBtn.textContent = " ✕";
    closeBtn.style.cssText = `
      cursor: pointer;
      margin-left: 10px;
      font-weight: bold;
    `;
    closeBtn.onclick = () => messageDiv.remove();
    messageDiv.appendChild(closeBtn);
  }

  // Auto-remove after duration (if not 0)
  if (duration > 0) {
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, duration);
  }

  return messageDiv;
}

// Export functions if needed
if (typeof module !== "undefined") {
  module.exports = {
    sendMessage,
    readStorage,
    writeStorage,
    showNotification,
  };
}
