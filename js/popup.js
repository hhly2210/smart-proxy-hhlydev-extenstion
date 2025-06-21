// Popup script for handling user interactions and UI
document.addEventListener("DOMContentLoaded", function () {
  // DOM elements - General Tab
  const proxyToggle = document.getElementById("proxyToggle");
  const proxyType = document.getElementById("proxyType");
  const proxyServer = document.getElementById("proxyServer");
  const proxyPort = document.getElementById("proxyPort");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const bypassList = document.getElementById("bypassList");
  const saveButton = document.getElementById("saveButton");
  const mtprotoOptions = document.getElementById("mtprotoOptions");
  const mtprotoSecret = document.getElementById("mtprotoSecret");
  const authContainer = document.getElementById("authContainer");

  // DOM elements - Tabs
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".proxy-config");

  // DOM elements - Domain Rules
  const domainRulesContainer = document.getElementById(
    "domain-rules-container"
  );
  const domainPattern = document.getElementById("domainPattern");
  const domainProxyType = document.getElementById("domainProxyType");
  const domainProxyServer = document.getElementById("domainProxyServer");
  const domainProxyPort = document.getElementById("domainProxyPort");
  const domainUsername = document.getElementById("domainUsername");
  const domainPassword = document.getElementById("domainPassword");
  const domainMtprotoOptions = document.getElementById("domainMtprotoOptions");
  const domainMtprotoSecret = document.getElementById("domainMtprotoSecret");
  const addDomainRuleButton = document.getElementById("addDomainRuleButton");
  const saveDomainRulesButton = document.getElementById(
    "saveDomainRulesButton"
  );

  // DOM elements - Tab Rules
  const activeTabsContainer = document.getElementById("active-tabs-container");
  const refreshTabsButton = document.getElementById("refreshTabsButton");
  const saveTabRulesButton = document.getElementById("saveTabRulesButton");

  // Initialize tabs
  initializeTabs();

  // Load all settings
  loadSettings();
  loadDomainRules();
  loadActiveTabs();

  // Event listeners - General
  proxyToggle.addEventListener("change", function () {
    const isEnabled = proxyToggle.checked;
    toggleFormFields(isEnabled);
    updateProxyTypeFields();
  });

  // Add event listener for proxy type changes to show MTProto warning
  proxyType.addEventListener("change", function () {
    const diagInfo = document.getElementById("diagInfo");

    if (this.value === "mtproto") {
      // Show warning about MTProto limitations
      if (diagInfo) {
        diagInfo.textContent =
          "Note: Browsers have limited support for MTProto. For Telegram Web, SOCKS5 may work better.";
        diagInfo.style.color = "#744";
      }

      // Show info notification
      showNotification(
        "Browser limitations may prevent MTProto proxies from working with Telegram web. Consider using SOCKS5 instead.",
        "info",
        8000
      );
    } else if (diagInfo && diagInfo.textContent.includes("MTProto")) {
      // Reset diagnostic info if it was showing the MTProto warning
      diagInfo.textContent = "Click to run proxy diagnostics for Telegram";
      diagInfo.style.color = "";
    }
  });

  proxyType.addEventListener("change", updateProxyTypeFields);
  saveButton.addEventListener("click", saveSettings);

  // Event listeners - Domains
  domainProxyType.addEventListener("change", updateDomainProxyTypeFields);
  addDomainRuleButton.addEventListener("click", addDomainRule);
  saveDomainRulesButton.addEventListener("click", saveDomainRules);

  // Event listeners - Tabs
  refreshTabsButton.addEventListener("click", loadActiveTabs);
  saveTabRulesButton.addEventListener("click", saveTabRules);

  // Tab navigation
  function initializeTabs() {
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        // Remove active class from all buttons and hide all content
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        tabContents.forEach((content) => (content.style.display = "none"));

        // Add active class to clicked button and show corresponding content
        button.classList.add("active");
        const tabId = button.dataset.tab;
        document.getElementById(`${tabId}-tab`).style.display = "block";
      });
    });
  } // Functions - General Settings
  function loadSettings() {
    // MODIFIED LOGIC: Default to direct connection (proxy disabled)
    // Use utility function for safer reading
    readStorage({
      enabled: false, // Always default to disabled (direct connection)
      proxyType: "http",
      server: "",
      port: 8080,
      username: "",
      password: "",
      bypassList: "",
      mtprotoSecret: "",
    })
      .then((items) => {
        // Enforce default direct connection behavior on first load
        const isFirstLoad = !localStorage.getItem("hasVisitedBefore");
        if (isFirstLoad) {
          localStorage.setItem("hasVisitedBefore", "true");
          // Display message about direct connection default
          showNotification(
            "Smart Proxy is using direct connection by default. Configure domain or tab-specific rules to use proxies.",
            "info",
            5000
          );
        }

        proxyToggle.checked = items.enabled;
        proxyType.value = items.proxyType;
        proxyServer.value = items.server;
        proxyPort.value = items.port;
        username.value = items.username;
        password.value = items.password;
        bypassList.value = items.bypassList;
        mtprotoSecret.value = items.mtprotoSecret || "";

        // Initial UI state
        toggleFormFields(items.enabled);
        updateProxyTypeFields();
      })
      .catch((error) => {
        console.error("Error loading settings:", error);
        showNotification("Error loading settings: " + error.message, "error");
      });
  }

  function updateProxyTypeFields() {
    // Show/hide MTProto specific fields
    const isMTProto = proxyType.value.toLowerCase() === "mtproto";
    mtprotoOptions.style.display = isMTProto ? "block" : "none";
    authContainer.style.display = isMTProto ? "none" : "block";
  }

  function updateDomainProxyTypeFields() {
    // Show/hide MTProto specific fields for domain rules
    const isMTProto = domainProxyType.value.toLowerCase() === "mtproto";
    const isDirect = domainProxyType.value.toLowerCase() === "direct";

    domainMtprotoOptions.style.display = isMTProto ? "block" : "none";
    document.querySelector(".domain-auth-container").style.display =
      isMTProto || isDirect ? "none" : "block";

    // Hide server/port fields for DIRECT connection
    document.querySelector(".domain-proxy-server").style.display = isDirect
      ? "none"
      : "block";
    document.querySelector(".domain-proxy-port").style.display = isDirect
      ? "none"
      : "block";
  }
  function saveSettings() {
    const settings = {
      enabled: proxyToggle.checked,
      proxyType: proxyType.value,
      server: proxyServer.value.trim(),
      port: parseInt(proxyPort.value, 10),
      username: username.value.trim(),
      password: password.value,
      bypassList: bypassList.value.trim(),
      mtprotoSecret: mtprotoSecret.value.trim(),
    };

    // Validate inputs
    if (
      settings.enabled &&
      (!settings.server || !settings.port) &&
      settings.proxyType !== "direct"
    ) {
      showNotification("Please enter a valid server and port.", "error");
      return;
    }

    // Validate MTProto specific inputs
    if (
      settings.enabled &&
      settings.proxyType.toLowerCase() === "mtproto" &&
      !settings.mtprotoSecret
    ) {
      showNotification("Please enter a secret key for MTProto proxy.", "error");
      return;
    }

    // Show saving message
    const savingMessage = showNotification("Saving settings...");

    // Save to storage using utility function
    writeStorage(settings)
      .then(() => {
        console.log("Settings stored in sync storage");
        return sendMessage({
          action: "updateProxySettings",
          settings: settings,
        });
      })
      .then((response) => {
        // Remove saving indicator
        if (savingMessage) savingMessage.remove();

        if (response && response.success) {
          showNotification("Settings saved!");
        } else {
          console.error("Error response from updateProxySettings:", response);
          showNotification(
            "Error saving settings: " +
              (response ? response.error : "Unknown error"),
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Error in saveSettings:", error);
        if (savingMessage) savingMessage.remove();
        showNotification(
          "Error: " + (error.message || "Unknown error"),
          "error"
        );
      });
  }

  function toggleFormFields(enabled) {
    const fields = [
      proxyType,
      proxyServer,
      proxyPort,
      username,
      password,
      bypassList,
      mtprotoSecret,
    ];
    fields.forEach((field) => (field.disabled = !enabled));
  }

  // Functions - Domain Rules
  function loadDomainRules() {
    chrome.storage.sync.get({ domainRules: [] }, function (data) {
      domainRulesContainer.innerHTML = "";

      if (data.domainRules.length === 0) {
        domainRulesContainer.innerHTML =
          "<p>No domain rules configured yet.</p>";
        return;
      }

      data.domainRules.forEach((rule, index) => {
        const ruleElement = createDomainRuleElement(rule, index);
        domainRulesContainer.appendChild(ruleElement);
      });
    });
  }

  function createDomainRuleElement(rule, index) {
    const ruleDiv = document.createElement("div");
    ruleDiv.className = "domain-rule";
    ruleDiv.dataset.index = index;

    const header = document.createElement("div");
    header.className = "domain-rule-header";

    const pattern = document.createElement("div");
    pattern.className = "domain-rule-pattern";
    pattern.textContent = rule.pattern;
    header.appendChild(pattern);

    const actions = document.createElement("div");
    actions.className = "domain-rule-actions";

    const editButton = document.createElement("button");
    editButton.className = "edit-rule-btn";
    editButton.innerHTML = "Edit";
    editButton.addEventListener("click", () => editDomainRule(index));
    actions.appendChild(editButton);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-rule-btn";
    deleteButton.innerHTML = "Delete";
    deleteButton.addEventListener("click", () => deleteDomainRule(index));
    actions.appendChild(deleteButton);

    header.appendChild(actions);
    ruleDiv.appendChild(header);

    const details = document.createElement("div");
    details.className = "domain-rule-details";

    // Proxy type detail
    const typeDetail = document.createElement("div");
    typeDetail.className = "domain-rule-detail";
    typeDetail.textContent = `Type: ${rule.proxyType.toUpperCase()}`;
    details.appendChild(typeDetail);

    // Server & port detail (if not DIRECT)
    if (rule.proxyType.toLowerCase() !== "direct") {
      const serverDetail = document.createElement("div");
      serverDetail.className = "domain-rule-detail";
      serverDetail.textContent = `Server: ${rule.server}:${rule.port}`;
      details.appendChild(serverDetail);
    }

    ruleDiv.appendChild(details);
    return ruleDiv;
  }

  function addDomainRule() {
    const rule = {
      pattern: domainPattern.value.trim(),
      proxyType: domainProxyType.value,
      server: domainProxyServer.value.trim(),
      port: parseInt(domainProxyPort.value, 10) || 0,
      username: domainUsername.value.trim(),
      password: domainPassword.value,
      mtprotoSecret: domainMtprotoSecret.value.trim(),
    };

    // Validate rule
    if (!rule.pattern) {
      alert("Please enter a domain pattern.");
      return;
    }

    if (
      rule.proxyType.toLowerCase() !== "direct" &&
      (!rule.server || !rule.port)
    ) {
      alert("Please enter a valid server and port.");
      return;
    }

    if (rule.proxyType.toLowerCase() === "mtproto" && !rule.mtprotoSecret) {
      alert("Please enter a secret key for MTProto proxy.");
      return;
    }

    // Add the rule to storage
    chrome.storage.sync.get({ domainRules: [] }, function (data) {
      const rules = data.domainRules;
      rules.push(rule);

      chrome.storage.sync.set({ domainRules: rules }, function () {
        // Refresh the list
        loadDomainRules();

        // Clear the form
        domainPattern.value = "";
        domainProxyServer.value = "";
        domainProxyPort.value = "";
        domainUsername.value = "";
        domainPassword.value = "";
        domainMtprotoSecret.value = "";

        // Regenerate PAC file
        chrome.runtime.sendMessage({ action: "updatePacFile" });

        showSavedMessage("Rule added!");
      });
    });
  }

  function editDomainRule(index) {
    chrome.storage.sync.get({ domainRules: [] }, function (data) {
      const rule = data.domainRules[index];
      if (!rule) return;

      // Populate form with rule data
      domainPattern.value = rule.pattern;
      domainProxyType.value = rule.proxyType;
      domainProxyServer.value = rule.server || "";
      domainProxyPort.value = rule.port || "";
      domainUsername.value = rule.username || "";
      domainPassword.value = rule.password || "";
      domainMtprotoSecret.value = rule.mtprotoSecret || "";

      // Update UI based on proxy type
      updateDomainProxyTypeFields();

      // Remove the existing rule
      deleteDomainRule(index);

      // Scroll to form
      document
        .querySelector(".domain-rule-form")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  function deleteDomainRule(index) {
    chrome.storage.sync.get({ domainRules: [] }, function (data) {
      const rules = data.domainRules;
      rules.splice(index, 1);

      chrome.storage.sync.set({ domainRules: rules }, function () {
        loadDomainRules();
        chrome.runtime.sendMessage({ action: "updatePacFile" });
      });
    });
  }
  function saveDomainRules() {
    // Show saving message
    const savingMessage = showNotification("Saving domain rules...");

    // Simply refresh the PAC file using utility function
    sendMessage({ action: "updatePacFile" })
      .then((response) => {
        // Remove saving indicator
        if (savingMessage) savingMessage.remove();

        if (response && response.success) {
          showNotification("Domain rules saved!");
        } else {
          console.error("Error response from updatePacFile:", response);
          showNotification(
            "Error saving domain rules: " +
              (response ? response.error : "Unknown error"),
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Error in saveDomainRules:", error);
        if (savingMessage) savingMessage.remove();
        showNotification(
          "Error: " + (error.message || "Unknown error"),
          "error"
        );
      });
  }

  // Functions - Tab Rules
  function loadActiveTabs() {
    activeTabsContainer.innerHTML = "<p>Loading tabs...</p>";

    chrome.tabs.query({}, function (tabs) {
      chrome.storage.sync.get({ tabRules: {} }, function (data) {
        const tabRules = data.tabRules;
        activeTabsContainer.innerHTML = "";

        if (tabs.length === 0) {
          activeTabsContainer.innerHTML = "<p>No tabs found.</p>";
          return;
        } // Get list of proxy configurations for dropdowns
        chrome.storage.sync.get({ domainRules: [] }, function (domainData) {
          const proxyOptions = [
            // Changed: Make Direct Connection the default option for better clarity
            { value: "direct", label: "Direct Connection (Default)" },
            { value: "default", label: "Use Global Proxy Settings" },
            ...domainData.domainRules.map((rule, index) => ({
              value: `rule_${index}`,
              label: `${rule.pattern} (${rule.proxyType.toUpperCase()})`,
            })),
          ];

          tabs.forEach((tab) => {
            const tabElement = createTabElement(
              tab,
              tabRules[tab.id],
              proxyOptions
            );
            activeTabsContainer.appendChild(tabElement);
          });
        });
      });
    });
  }

  function createTabElement(tab, currentRule, proxyOptions) {
    const tabDiv = document.createElement("div");
    tabDiv.className = "tab-item";
    tabDiv.dataset.tabId = tab.id;

    // Favicon
    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.src = tab.favIconUrl || "icons/icon16.png";
    tabDiv.appendChild(favicon);

    // Tab info
    const info = document.createElement("div");
    info.className = "tab-info";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title;
    info.appendChild(title);

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.url;
    info.appendChild(url);

    tabDiv.appendChild(info);

    // Proxy selector
    const selector = document.createElement("select");
    selector.className = "tab-proxy-selector";
    selector.dataset.tabId = tab.id;

    proxyOptions.forEach((option) => {
      const optElement = document.createElement("option");
      optElement.value = option.value;
      optElement.textContent = option.label;

      if (currentRule && currentRule.value === option.value) {
        optElement.selected = true;
      }

      selector.appendChild(optElement);
    });

    tabDiv.appendChild(selector);

    return tabDiv;
  }
  function saveTabRules() {
    const selectors = document.querySelectorAll(".tab-proxy-selector");
    const tabRules = {};
    let hasNonDefaultRules = false;

    selectors.forEach((selector) => {
      const tabId = parseInt(selector.dataset.tabId, 10);
      const value = selector.value;

      if (value !== "default") {
        tabRules[tabId] = { value };
        hasNonDefaultRules = true;
      }
    });

    // Show saving indicator
    const savingMessage = showNotification("Saving tab rules...");

    // First verify we have a valid tabRules object
    if (!tabRules || typeof tabRules !== "object") {
      console.error("Invalid tabRules object:", tabRules);
      tabRules = {}; // Use an empty object as fallback
    }

    // Use the utility functions for better error handling
    writeStorage({ tabRules })
      .then(() => {
        console.log("Tab rules stored in sync storage:", tabRules);

        // Clear any existing tab patterns in local storage to prevent remnants
        return new Promise((resolve, reject) => {
          chrome.storage.local.set({ tabPatterns: [] }, () => {
            if (chrome.runtime.lastError) {
              console.warn(
                "Error clearing previous tab patterns:",
                chrome.runtime.lastError
              );
              // Continue anyway
            }
            resolve();
          });
        });
      })
      .then(() => {
        return sendMessage({ action: "updateTabProxies" });
      })
      .then((response) => {
        // Remove saving indicator
        if (savingMessage) savingMessage.remove();

        if (response && response.success) {
          // Explain what was done
          if (hasNonDefaultRules) {
            showNotification("Tab-specific proxy rules saved!");
          } else {
            showNotification(
              "All tabs set to use direct connection by default."
            );
          }
        } else {
          console.error("Error response from updateTabProxies:", response);
          // Show detailed error if available
          const errorMessage =
            response && response.error
              ? response.error
              : "Unknown error. Check the console for details.";
          showNotification(
            "Error saving tab rules: " + errorMessage,
            "error",
            0
          );
        }
      })
      .catch((error) => {
        console.error("Error in saveTabRules:", error);
        if (savingMessage) savingMessage.remove();
        showNotification(
          "Error: " + (error.message || "Unknown error"),
          "error"
        );
      });
  } // Use the utility function instead
  function showSavedMessage(message = "Settings saved!", type = "success") {
    return showNotification(message, type);
  }

  // Add handler for diagnostics button
  const diagButton = document.getElementById("diagButton");
  if (diagButton) {
    diagButton.addEventListener("click", async function () {
      // Show that diagnostics are running
      const diagInfo = document.getElementById("diagInfo");
      if (diagInfo) {
        diagInfo.textContent = "Running diagnostics...";
        diagInfo.style.color = "#437";
      }

      try {
        // Run diagnostics in background script
        const response = await sendMessage({ action: "runDiagnostics" });

        if (response && response.success) {
          if (diagInfo) {
            diagInfo.textContent =
              "Diagnostics complete! Check background console (F12) for details.";
            diagInfo.style.color = "green";
          }
          showNotification(
            "Diagnostics complete! Check console for details.",
            "success",
            5000
          );
        } else {
          if (diagInfo) {
            diagInfo.textContent =
              "Diagnostics failed. Check console for errors.";
            diagInfo.style.color = "red";
          }
          showNotification(
            "Diagnostics failed: " + (response.error || "Unknown error"),
            "error"
          );
        }
      } catch (error) {
        console.error("Error running diagnostics:", error);
        if (diagInfo) {
          diagInfo.textContent =
            "Error running diagnostics: " + (error.message || "Unknown error");
          diagInfo.style.color = "red";
        }
        showNotification(
          "Error: " + (error.message || "Failed to run diagnostics"),
          "error"
        );
      }
    });
  }

  // Add handler for Telegram proxy reload button
  const reloadTelegramButton = document.getElementById("reloadTelegramButton");
  if (reloadTelegramButton) {
    reloadTelegramButton.addEventListener("click", async function () {
      // Update button UI
      reloadTelegramButton.disabled = true;
      reloadTelegramButton.textContent = "Reloading...";

      // Update info text
      const diagInfo = document.getElementById("diagInfo");
      if (diagInfo) {
        diagInfo.textContent = "Reloading Telegram proxy settings...";
        diagInfo.style.color = "#174";
      }

      try {
        // Call background script to reload Telegram proxy
        const response = await sendMessage({ action: "reloadTelegramProxy" });

        if (response && response.success) {
          if (diagInfo) {
            diagInfo.textContent = "Telegram proxy reloaded successfully!";
            diagInfo.style.color = "green";
          }
          showNotification(
            "Telegram proxy reloaded. Please refresh Telegram web page.",
            "success",
            5000
          );

          // Test connectivity
          setTimeout(() => {
            sendMessage({ action: "testTelegramConnectivity" });
          }, 2000);
        } else {
          if (diagInfo) {
            diagInfo.textContent = "Failed to reload Telegram proxy.";
            diagInfo.style.color = "red";
          }
          showNotification(
            "Failed to reload Telegram proxy: " +
              (response.error || "No MTProto rules found"),
            "error"
          );
        }
      } catch (error) {
        console.error("Error reloading Telegram proxy:", error);
        if (diagInfo) {
          diagInfo.textContent = "Error: " + (error.message || "Unknown error");
          diagInfo.style.color = "red";
        }
        showNotification(
          "Error: " + (error.message || "Failed to reload Telegram proxy"),
          "error"
        );
      } finally {
        // Reset button state
        reloadTelegramButton.disabled = false;
        reloadTelegramButton.textContent = "Reload Telegram Proxy";
      }
    });
  }

  // Add handler for MTProto support check button
  const checkMTProtoButton = document.getElementById("checkMTProtoButton");
  if (checkMTProtoButton) {
    checkMTProtoButton.addEventListener("click", async function () {
      // Update button UI
      checkMTProtoButton.disabled = true;
      checkMTProtoButton.textContent = "Checking...";

      // Update info text
      const diagInfo = document.getElementById("diagInfo");
      if (diagInfo) {
        diagInfo.textContent = "Checking MTProto proxy compatibility...";
        diagInfo.style.color = "#744";
      }

      try {
        // Call background script to check MTProto support
        const response = await sendMessage({
          action: "diagnoseMTProtoSupport",
        });

        if (response && response.success && response.data) {
          const data = response.data;

          // Create a more detailed report in a modal
          const modal = document.createElement("div");
          modal.style.position = "fixed";
          modal.style.top = "50%";
          modal.style.left = "50%";
          modal.style.transform = "translate(-50%, -50%)";
          modal.style.zIndex = "1000";
          modal.style.backgroundColor = "white";
          modal.style.padding = "20px";
          modal.style.borderRadius = "8px";
          modal.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
          modal.style.maxWidth = "400px";
          modal.style.maxHeight = "80vh";
          modal.style.overflow = "auto";

          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.marginTop = "15px";
          closeBtn.style.padding = "5px 10px";
          closeBtn.style.float = "right";
          closeBtn.onclick = function () {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
          };

          const overlay = document.createElement("div");
          overlay.style.position = "fixed";
          overlay.style.top = "0";
          overlay.style.left = "0";
          overlay.style.width = "100%";
          overlay.style.height = "100%";
          overlay.style.backgroundColor = "rgba(0,0,0,0.5)";
          overlay.style.zIndex = "999";

          // Format the report content
          let reportContent = `
            <h2>MTProto Support Diagnostics</h2>
            <h3>Browser Information</h3>
            <p><strong>User Agent:</strong> ${data.browserInfo}</p>
            <p><strong>Chrome Version:</strong> ${data.chromeVersion}</p>
            
            <h3>Proxy Configuration</h3>
            <p><strong>Current Mode:</strong> ${
              data.currentConfig || "None"
            }</p>
            <p><strong>PAC Script:</strong> ${data.pacScriptStatus || "N/A"}</p>
            <p><strong>MTProto Active:</strong> ${
              data.mtprotoActive ? "Yes" : "No"
            }</p>
            
            <h3>MTProto Details</h3>
          `;

          if (data.mtprotoDetails) {
            reportContent += `
              <p><strong>Server:</strong> ${data.mtprotoDetails.server}:${
              data.mtprotoDetails.port
            }</p>
              <p><strong>Secret Key:</strong> ${
                data.mtprotoDetails.secretProvided ? "Provided" : "Missing"
              }</p>
              <p><strong>Last Activated:</strong> ${
                data.mtprotoDetails.lastActivated
              }</p>
            `;
          } else {
            reportContent += `<p>No MTProto proxy has been activated yet.</p>`;
          }

          reportContent += `
            <h3>Telegram Rules</h3>
            ${
              data.telegramRules.length > 0
                ? data.telegramRules
                    .map(
                      (rule) =>
                        `<p><strong>${rule.pattern}</strong> → ${rule.type}</p>`
                    )
                    .join("")
                : "<p>No Telegram-specific rules found.</p>"
            }
            
            <h3>PAC Script</h3>
            <p>Telegram matches in PAC script: ${
              data.telegramPacMatches || "Not found"
            }</p>
            
            <h3>Browser Limitations</h3>
            <p>${data.recommendation}</p>
            
            <h3>Recommendation</h3>
            <p>If you need to use MTProto proxies with Telegram web, consider:</p>
            <ol>
              <li>Using a regular SOCKS5 proxy instead that's compatible with Telegram</li>
              <li>Using the Telegram desktop app which has native MTProto support</li>
              <li>Setting up a local proxy service that can translate between SOCKS5 and MTProto protocols</li>
            </ol>
          `;

          modal.innerHTML = reportContent;
          modal.appendChild(closeBtn);

          document.body.appendChild(overlay);
          document.body.appendChild(modal);

          if (diagInfo) {
            diagInfo.textContent = "MTProto check complete - see report";
            diagInfo.style.color = "green";
          }
        } else {
          if (diagInfo) {
            diagInfo.textContent =
              "MTProto check failed: " + (response.error || "Unknown error");
            diagInfo.style.color = "red";
          }
        }
      } catch (error) {
        console.error("Error checking MTProto support:", error);
        if (diagInfo) {
          diagInfo.textContent = "Error: " + (error.message || "Unknown error");
          diagInfo.style.color = "red";
        }
      } finally {
        // Reset button state
        checkMTProtoButton.disabled = false;
        checkMTProtoButton.textContent = "Check MTProto Support";
      }
    });
  }
});
