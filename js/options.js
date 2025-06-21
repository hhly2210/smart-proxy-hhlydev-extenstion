// Options page script
document.addEventListener("DOMContentLoaded", function () {
  // DOM elements
  const startupBehavior = document.getElementById("startupBehavior");
  const showNotifications = document.getElementById("showNotifications");
  const autoReconnect = document.getElementById("autoReconnect");
  const useCustomPac = document.getElementById("useCustomPac");
  const customPacContainer = document.getElementById("customPacContainer");
  const customPacScript = document.getElementById("customPacScript");
  const blockWebRTC = document.getElementById("blockWebRTC");
  const exportButton = document.getElementById("exportButton");
  const importButton = document.getElementById("importButton");
  const importFile = document.getElementById("importFile");
  const resetButton = document.getElementById("resetButton");
  const saveButton = document.getElementById("saveButton");
  const statusMessage = document.getElementById("statusMessage");

  // Load saved options
  loadOptions();

  // Event listeners
  useCustomPac.addEventListener("change", function () {
    customPacContainer.style.display = useCustomPac.checked ? "block" : "none";
  });

  saveButton.addEventListener("click", saveOptions);
  exportButton.addEventListener("click", exportSettings);
  importButton.addEventListener("click", function () {
    importFile.click();
  });
  importFile.addEventListener("change", importSettings);
  resetButton.addEventListener("click", resetSettings);

  function loadOptions() {
    chrome.storage.sync.get(
      {
        startupBehavior: "remember",
        showNotifications: true,
        autoReconnect: false,
        useCustomPac: false,
        customPacScript: getDefaultPacTemplate(),
        blockWebRTC: false,
      },
      function (items) {
        startupBehavior.value = items.startupBehavior;
        showNotifications.checked = items.showNotifications;
        autoReconnect.checked = items.autoReconnect;
        useCustomPac.checked = items.useCustomPac;
        customPacScript.value = items.customPacScript;
        blockWebRTC.checked = items.blockWebRTC;

        // Update UI based on options
        customPacContainer.style.display = items.useCustomPac
          ? "block"
          : "none";
      }
    );
  }

  function saveOptions() {
    const options = {
      startupBehavior: startupBehavior.value,
      showNotifications: showNotifications.checked,
      autoReconnect: autoReconnect.checked,
      useCustomPac: useCustomPac.checked,
      customPacScript: customPacScript.value,
      blockWebRTC: blockWebRTC.checked,
    };

    // Validate custom PAC script if enabled
    if (options.useCustomPac) {
      try {
        // Simple validation to check if it's valid JavaScript
        new Function(options.customPacScript);

        // Check if it contains the required FindProxyForURL function
        if (!options.customPacScript.includes("function FindProxyForURL")) {
          throw new Error("PAC script must contain a FindProxyForURL function");
        }
      } catch (error) {
        showStatus("Error: Invalid PAC script - " + error.message, "error");
        return;
      }
    }

    chrome.storage.sync.set(options, function () {
      showStatus("Options saved successfully!", "success");

      // Notify background script to update settings
      chrome.runtime.sendMessage({
        action: "updateOptionsSettings",
        settings: options,
      });
    });
  }

  function exportSettings() {
    chrome.storage.sync.get(null, function (items) {
      // Convert settings object to JSON string
      const settingsJson = JSON.stringify(items, null, 2);

      // Create blob and download link
      const blob = new Blob([settingsJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

      // Create download link and trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = `smart-proxy-settings-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 0);

      showStatus("Settings exported successfully!", "success");
    });
  }

  function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const settings = JSON.parse(e.target.result);

        chrome.storage.sync.set(settings, function () {
          // Reload options to reflect imported settings
          loadOptions();

          // Notify background script
          chrome.runtime.sendMessage({
            action: "updateOptionsSettings",
            settings: settings,
          });

          showStatus("Settings imported successfully!", "success");
        });
      } catch (error) {
        showStatus("Error importing settings: Invalid JSON file", "error");
      }
    };

    reader.readAsText(file);

    // Reset the file input
    event.target.value = null;
  }

  function resetSettings() {
    if (
      confirm(
        "Are you sure you want to reset all settings? This action cannot be undone."
      )
    ) {
      chrome.storage.sync.clear(function () {
        // Load default options
        loadOptions();

        // Notify background script
        chrome.runtime.sendMessage({ action: "resetSettings" });

        showStatus("All settings have been reset to defaults", "success");
      });
    }
  }

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = "status-message " + type;

    // Hide after 3 seconds
    setTimeout(function () {
      statusMessage.className = "status-message";
    }, 3000);
  }

  function getDefaultPacTemplate() {
    return `function FindProxyForURL(url, host) {
  // This is a template for a custom PAC script
  // Modify it according to your needs
  
  // Example: Use SOCKS proxy for specific domains
  if (shExpMatch(host, "*.example.com") || 
      shExpMatch(host, "example.org")) {
    return "SOCKS5 127.0.0.1:1080";
  }
  
  // Example: Use HTTP proxy for another set of domains
  if (shExpMatch(host, "*.somesite.com")) {
    return "PROXY 127.0.0.1:8080";
  }
  
  // Default: Connect directly
  return "DIRECT";
}`;
  }
});
