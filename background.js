// Background script for handling proxy configuration
// This runs as a service worker in Manifest V3

// Initialize proxy settings when extension is installed or updated
chrome.runtime.onInstalled.addListener(function () {
  loadAndApplySettings();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("Received message with action:", request.action);

  // Keep track of whether we've responded yet
  let hasResponded = false;

  // Helper to safely send a response and avoid duplicate responses
  const safeResponse = (success, error = null) => {
    if (hasResponded) {
      console.log("Attempted to send duplicate response, ignoring");
      return;
    }

    try {
      if (success) {
        sendResponse({ success: true });
      } else {
        sendResponse({
          success: false,
          error: (error && error.message) || "Unknown error",
        });
      }
      hasResponded = true;
    } catch (err) {
      console.error("Error sending response:", err);
    }
  };

  if (request.action === "updateProxySettings") {
    applyProxySettings(request.settings)
      .then(() => safeResponse(true))
      .catch((error) => {
        console.error("Error in updateProxySettings:", error);
        safeResponse(false, error);
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
  if (request.action === "updatePacFile") {
    generateAndApplyPacFile()
      .then(() => safeResponse(true))
      .catch((error) => {
        console.error("Error in updatePacFile:", error);
        safeResponse(false, error);
      });

    return true;
  }
  if (request.action === "updateOptionsSettings") {
    // Handle options page settings
    updateOptionsSettings(request.settings)
      .then(() => safeResponse(true))
      .catch((error) => {
        console.error("Error in updateOptionsSettings:", error);
        safeResponse(false, error);
      });

    return true;
  }
  if (request.action === "updateTabProxies") {
    // Set a timeout to ensure we send a response even if the operation takes too long
    const timeoutId = setTimeout(() => {
      console.warn("updateTabProxies operation timed out after 5 seconds");
      safeResponse(true); // Send success with a warning in the logs
    }, 5000);

    // Handle tab-specific proxy settings
    applyTabProxies()
      .then(() => {
        clearTimeout(timeoutId); // Clear the timeout
        safeResponse(true);
      })
      .catch((error) => {
        clearTimeout(timeoutId); // Clear the timeout
        console.error("Error in applyTabProxies:", error);
        safeResponse(false, error);
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
  if (request.action === "resetSettings") {
    // Handle reset from options page
    loadAndApplySettings()
      .then(() => safeResponse(true))
      .catch((error) => {
        console.error("Error in resetSettings:", error);
        safeResponse(false, error);
      });

    return true;
  }
});

// Listen for tab updates to apply tab-specific proxies
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === "complete") {
    applyTabProxy(tabId, tab.url);
  }
});

// Listen for tab creation to apply tab-specific proxies
chrome.tabs.onCreated.addListener(function (tab) {
  applyTabProxy(tab.id, tab.url);
});

// Load settings and apply proxy configuration
function loadAndApplySettings() {
  // MODIFIED: Default to direct connection unless specifically overridden
  const useDirectByDefault = true; // Theo yêu cầu: mặc định luôn là direct connection

  chrome.storage.sync.get(
    {
      enabled: false,
      proxyType: "http",
      server: "",
      port: 8080,
      username: "",
      password: "",
      bypassList: "",
      mtprotoSecret: "",
      domainRules: [],
      useCustomPac: false,
    },
    function (settings) {
      // Always use direct connection by default unless explicitly configured otherwise
      if (useDirectByDefault && !settings.enabled) {
        // Set direct connection
        chrome.proxy.settings.set(
          {
            value: { mode: "direct" },
            scope: "regular",
          },
          () => {
            console.log("Set to direct connection by default");
          }
        );
      } else if (settings.useCustomPac || settings.domainRules.length > 0) {
        generateAndApplyPacFile().catch(console.error);
      } else {
        applyProxySettings(settings).catch(console.error);
      }
    }
  );
}

// Apply proxy settings to Chrome's proxy settings
async function applyProxySettings(settings) {
  // MODIFIED LOGIC: User preference is to default to direct connection
  const useDirectByDefault = true; // Theo yêu cầu: mặc định luôn là direct connection

  if (!settings.enabled || useDirectByDefault) {
    // If proxy is disabled or user prefers direct connection by default
    await chrome.proxy.settings.set({
      value: { mode: "direct" },
      scope: "regular",
    });
    console.log(
      "Using direct connection (proxy disabled or by user preference)"
    );
    return;
  }

  // Check if we should use PAC file instead
  const domainRulesExist = await checkIfDomainRulesExist();
  if (domainRulesExist) {
    await generateAndApplyPacFile();
    return;
  }

  // Process bypass list
  const bypassDomains = settings.bypassList
    ? settings.bypassList.split(/[\s,]+/).filter(Boolean)
    : [];

  // Build proxy configuration
  const config = {
    mode: "fixed_servers",
    rules: {
      bypassList: bypassDomains,
    },
  };

  // Set appropriate proxy scheme based on type
  const proxyScheme = `${settings.proxyType}://`;

  // Add authentication if provided
  let proxyString = "";
  if (settings.username && settings.password) {
    proxyString = `${settings.username}:${settings.password}@`;
  }

  // Complete the proxy string with server and port
  proxyString += `${settings.server}:${settings.port}`;

  // Set proxy configuration based on type
  if (settings.proxyType === "http" || settings.proxyType === "https") {
    config.rules.singleProxy = {
      scheme: settings.proxyType,
      host: settings.server,
      port: settings.port,
    };
  } else if (
    settings.proxyType === "socks4" ||
    settings.proxyType === "socks5"
  ) {
    config.rules.singleProxy = {
      scheme: "socks",
      host: settings.server,
      port: settings.port,
    };
  } else if (settings.proxyType === "mtproto") {
    // MTProto proxy implementation (uses SOCKS5 underneath)
    config.rules.singleProxy = {
      scheme: "socks5",
      host: settings.server,
      port: settings.port,
    };

    // Handle MTProto specific details
    if (settings.mtprotoSecret) {
      console.log("Setting up MTProto proxy with secret key for Telegram");

      // Store MTProto settings
      chrome.storage.local.set({
        mtprotoActive: true,
        mtprotoDetails: {
          server: settings.server,
          port: settings.port,
          secret: settings.mtprotoSecret,
        },
      });

      // Set up Telegram domains with the MTProto proxy
      setupTelegramDomainRules(settings);

      console.log("MTProto proxy settings saved with secret key");
    }
  }

  // Apply proxy settings
  await chrome.proxy.settings.set({
    value: config,
    scope: "regular",
  });

  console.log(`Proxy enabled: ${proxyScheme}${proxyString}`);
}

// Check if domain rules exist
async function checkIfDomainRulesExist() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ domainRules: [] }, function (data) {
      resolve(data.domainRules.length > 0);
    });
  });
}

// Generate and apply PAC file based on domain rules
async function generateAndApplyPacFile() {
  console.log("Generating PAC file...");

  // Initialize variables with default values to prevent 'undefined' errors
  let settings = {
    enabled: false,
    proxyType: "direct",
    server: "",
    port: 8080,
    username: "",
    password: "",
    mtprotoSecret: "",
  };
  let domainRules = { domainRules: [] };
  let tabPatternsObj = { tabPatterns: [] }; // Always initialize with default

  try {
    // Fetch required data from storage
    try {
      // Get general settings
      settings = await getStorageData({
        enabled: false,
        proxyType: "http",
        server: "",
        port: 8080,
        username: "",
        password: "",
        mtprotoSecret: "",
      });

      // Get domain rules
      domainRules = await getStorageData({ domainRules: [] });

      // Ensure domain rules is always an array
      if (!domainRules || !domainRules.domainRules) {
        console.warn("Invalid domainRules, using empty array");
        domainRules = { domainRules: [] };
      }

      // Get tab patterns
      tabPatternsObj = await new Promise((resolve) => {
        try {
          chrome.storage.local.get({ tabPatterns: [] }, (result) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error getting tab patterns:",
                chrome.runtime.lastError
              );
              // Mặc định là mảng rỗng nếu có lỗi
              resolve({ tabPatterns: [] });
            } else {
              console.log("Retrieved tab patterns:", JSON.stringify(result));
              resolve(result);
            }
          });
        } catch (err) {
          console.error("Exception getting tab patterns:", err);
          resolve({ tabPatterns: [] });
        }
      });

      // Đảm bảo tabPatterns luôn là một mảng
      if (!tabPatternsObj || !tabPatternsObj.tabPatterns) {
        console.warn("Invalid tabPatternsObj, using default empty array");
        tabPatternsObj = { tabPatterns: [] };
      }
    } catch (err) {
      console.error("Error getting configuration:", err);
      // Giữ giá trị mặc định đã khởi tạo ở trên
    }
    console.log("Retrieved settings, domain rules, and tab patterns", {
      settings,
      domainRules: domainRules.domainRules ? domainRules.domainRules.length : 0,
      tabPatterns: tabPatternsObj.tabPatterns
        ? tabPatternsObj.tabPatterns.length
        : 0,
    });

    // MODIFIED LOGIC: Always use direct connection by default, unless there are specific domain or tab rules
    // Use this default logic if user prefers direct connections by default
    const useDirectByDefault = true; // Theo yêu cầu: mặc định luôn là direct connection

    // Đảm bảo các thuộc tính đều tồn tại để tránh lỗi undefined
    const hasDomainRules =
      domainRules &&
      domainRules.domainRules &&
      domainRules.domainRules.length > 0;
    const hasTabPatterns =
      tabPatternsObj &&
      tabPatternsObj.tabPatterns &&
      tabPatternsObj.tabPatterns.length > 0;
    const isProxyEnabled = settings && settings.enabled; // Check if we should use direct connection
    // MTProto handling - even if we use direct connection by default,
    // we still want to generate PAC if there are MTProto proxy settings for Telegram
    const hasMtprotoRulesForTelegram =
      domainRules &&
      domainRules.domainRules &&
      domainRules.domainRules.some(
        (rule) =>
          rule.proxyType === "mtproto" &&
          (rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
      );

    // Check if we should use direct connection
    if (
      !hasDomainRules &&
      !hasTabPatterns &&
      !hasMtprotoRulesForTelegram &&
      (!isProxyEnabled || useDirectByDefault)
    ) {
      console.log(
        "Using direct connection by default - no special rules found"
      );

      try {
        await chrome.proxy.settings.set({
          value: { mode: "direct" },
          scope: "regular",
        });
        console.log("Successfully set direct connection");
        return; // Exit early since we've set direct connection
      } catch (err) {
        console.error("Error setting direct connection:", err);
        throw err;
      }
    }

    // If we have MTProto rules for Telegram, make sure to log this
    if (hasMtprotoRulesForTelegram) {
      console.log(
        "Found MTProto rules for Telegram domains - generating PAC file"
      );
    }

    console.log("Rules found or proxy enabled, generating PAC script");
  } catch (error) {
    console.error("Error in generateAndApplyPacFile initialization:", error);
    // Đặt kết nối trực tiếp khi có lỗi
    try {
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular",
      });
      console.log("Set direct connection due to error");
    } catch (err) {
      console.error("Failed to set direct connection after error:", err);
    }
    throw error;
  } // Generate PAC file content - make sure it's ASCII only (for Chrome restrictions)
  let pacScript = `function FindProxyForURL(url, host) {
    // Output simple log without special characters
    // console.log("PAC script evaluating proxy for: " + url + " (host: " + host + ")");
    
    // Helper function to check if a host matches a pattern
    function hostMatchesPattern(host, pattern) {
      // Handle wildcard patterns (*.domain.tld)
      if (pattern.startsWith("*.")) {
        const domainPart = pattern.substring(2);
        return host === domainPart || host.endsWith("." + domainPart);
      }
      
      // Convert wildcards to regex safely
      var regexText = pattern.replace(/\\./g, "\\\\.").replace(/\\*/g, ".*");
      var regex = new RegExp("^" + regexText + "$");
      return regex.test(host);
    }
    
    // Tab-specific rules first (take highest priority)`; // Add tab-specific rules - ensure ASCII only
  if (
    tabPatternsObj &&
    tabPatternsObj.tabPatterns &&
    tabPatternsObj.tabPatterns.length > 0
  ) {
    tabPatternsObj.tabPatterns.forEach((tabRule) => {
      // Validate the rule has necessary properties
      if (!tabRule || !tabRule.pattern || !tabRule.proxyType) {
        console.warn("Invalid tab rule:", tabRule);
        return; // Skip this rule
      }

      let proxyString;

      if (tabRule.proxyType.toLowerCase() === "direct") {
        proxyString = "DIRECT";
      } else if (tabRule.proxyType.toLowerCase() === "mtproto") {
        // Handle MTProto specifically for Telegram
        // MTProto uses SOCKS5 underneath
        proxyString = `SOCKS5 ${tabRule.server}:${tabRule.port}`;

        // Special handling for Telegram domains with MTProto
        const isTelegramPattern =
          tabRule.pattern.includes("telegram.org") ||
          tabRule.pattern.includes("t.me");

        if (isTelegramPattern) {
          // Use a special rule for Telegram domains
          pacScript += `
    // Telegram tab rule
    if (host === "${tabRule.pattern}" || 
        host === "web.telegram.org" || 
        host.endsWith(".t.me")) {
      return "${proxyString}";
    }`;
          return; // Skip the standard rule
        }
      } else {
        // For HTTP, HTTPS, SOCKS4, SOCKS5
        const authPart =
          tabRule.username && tabRule.password
            ? `${tabRule.username}:${tabRule.password}@`
            : "";

        if (
          tabRule.proxyType.toLowerCase() === "http" ||
          tabRule.proxyType.toLowerCase() === "https"
        ) {
          proxyString = `${tabRule.proxyType.toUpperCase()} ${authPart}${
            tabRule.server
          }:${tabRule.port}`;
        } else if (
          tabRule.proxyType.toLowerCase() === "socks4" ||
          tabRule.proxyType.toLowerCase() === "socks5"
        ) {
          proxyString = `SOCKS ${tabRule.server}:${tabRule.port}`;
        }
      }

      // Add tab rule to PAC script - ASCII ONLY, no console.log
      if (proxyString) {
        pacScript += `
    
    // Tab rule
    if (host === "${tabRule.pattern}") {
      return "${proxyString}";
    }`;
      }
    });
  }

  pacScript += `
    
    // Domain specific rules`; // Add domain rules - ensure ASCII only
  domainRules.domainRules.forEach((rule) => {
    // Skip invalid rules
    if (!rule || !rule.pattern || !rule.proxyType) {
      console.warn("Skipping invalid domain rule:", rule);
      return;
    }

    let proxyString;

    if (rule.proxyType.toLowerCase() === "direct") {
      proxyString = "DIRECT";
    } else if (rule.proxyType.toLowerCase() === "mtproto") {
      // MTProto uses SOCKS5 underneath
      proxyString = `SOCKS5 ${rule.server}:${rule.port}`;

      // Handle special case for Telegram domains with MTProto
      const isTelegramPattern =
        rule.pattern.includes("telegram.org") || rule.pattern.includes("t.me");

      if (isTelegramPattern) {
        // Add special case for telegram domains - ASCII ONLY, no console.log
        pacScript += `
    // Telegram MTProto rule
    if (hostMatchesPattern(host, "${rule.pattern}") || 
        host === "telegram.org" || 
        host.endsWith(".telegram.org") ||
        host === "t.me" ||
        host.endsWith(".t.me")) {
      return "${proxyString}";
    }`;
        return; // Skip the standard rule for Telegram domains
      }
    } else {
      // For HTTP, HTTPS, SOCKS4, SOCKS5
      const authPart =
        rule.username && rule.password
          ? `${rule.username}:${rule.password}@`
          : "";

      if (
        rule.proxyType.toLowerCase() === "http" ||
        rule.proxyType.toLowerCase() === "https"
      ) {
        proxyString = `${rule.proxyType.toUpperCase()} ${authPart}${
          rule.server
        }:${rule.port}`;
      } else if (
        rule.proxyType.toLowerCase() === "socks4" ||
        rule.proxyType.toLowerCase() === "socks5"
      ) {
        proxyString = `SOCKS ${rule.server}:${rule.port}`;
      }
    }

    // Add rule - ASCII ONLY, no console.log (which can cause issues)
    pacScript += `
    if (hostMatchesPattern(host, "${rule.pattern}")) {
      return "${proxyString}";
    }`;
  }); // Default connection logic - ASCII ONLY
  const useDirectByDefault = true; // Default to direct connection

  if (settings.enabled && !useDirectByDefault) {
    // Only use configured proxy as default if direct connection isn't forced
    let defaultProxyString;

    if (settings.proxyType.toLowerCase() === "mtproto") {
      defaultProxyString = `SOCKS5 ${settings.server}:${settings.port}`;
    } else if (
      settings.proxyType.toLowerCase() === "http" ||
      settings.proxyType.toLowerCase() === "https"
    ) {
      const authPart =
        settings.username && settings.password
          ? `${settings.username}:${settings.password}@`
          : "";
      defaultProxyString = `${settings.proxyType.toUpperCase()} ${authPart}${
        settings.server
      }:${settings.port}`;
    } else if (
      settings.proxyType.toLowerCase() === "socks4" ||
      settings.proxyType.toLowerCase() === "socks5"
    ) {
      defaultProxyString = `SOCKS ${settings.server}:${settings.port}`;
    } else {
      defaultProxyString = "DIRECT";
    }

    pacScript += `

    // Default proxy
    return "${defaultProxyString}";`;
  } else {
    pacScript += `

    // Direct connection
    return "DIRECT";`;
  }

  // Close the PAC function - ASCII ONLY, no comments with non-ASCII chars
  pacScript += `
}`;

  console.log("PAC script generated, now applying");

  // Log a small preview of the PAC file for debugging
  const pacPreview =
    pacScript.length > 500
      ? pacScript.substring(0, 200) +
        "..." +
        pacScript.substring(pacScript.length - 300)
      : pacScript;
  console.log("PAC script preview:", pacPreview);
  try {
    // Check for non-ASCII characters
    const containsNonAscii = /[^\x00-\x7F]/.test(pacScript);
    if (containsNonAscii) {
      console.warn("PAC script contains non-ASCII characters, removing them");
      // Replace non-ASCII characters with empty strings
      pacScript = pacScript.replace(/[^\x00-\x7F]/g, "");
    }

    // Apply PAC script
    await new Promise((resolve, reject) => {
      chrome.proxy.settings.set(
        {
          value: {
            mode: "pac_script",
            pacScript: {
              data: pacScript,
            },
          },
          scope: "regular",
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error setting proxy settings:",
              chrome.runtime.lastError
            );
            reject(chrome.runtime.lastError);
          } else {
            console.log("PAC script successfully applied");
            resolve();
          }
        }
      );
    });

    console.log("PAC script applied with domain and tab rules");
  } catch (error) {
    console.error("Error applying PAC script:", error);
    throw error;
  }
}

// Apply tab-specific proxy settings
async function applyTabProxies() {
  try {
    console.log("Starting applyTabProxies");

    // Get all active tabs
    const tabs = await new Promise((resolve, reject) => {
      try {
        chrome.tabs.query({}, (result) => {
          if (chrome.runtime.lastError) {
            console.error("Error querying tabs:", chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            console.log(`Found ${result.length} tabs`);
            resolve(result);
          }
        });
      } catch (err) {
        console.error("Exception in tabs.query:", err);
        reject(err);
      }
    });

    // Get tab rules
    const tabRules = await getStorageData({ tabRules: {} });
    console.log("Retrieved tab rules:", JSON.stringify(tabRules));

    // Generate tab-specific URL patterns for PAC file
    const tabPatterns = [];

    // Prepare tab rules for PAC script
    for (const tab of tabs) {
      if (tabRules.tabRules[tab.id] && tab.url) {
        // Skip empty URLs or non-HTTP URLs
        if (
          !tab.url ||
          (!tab.url.startsWith("http") && !tab.url.startsWith("https"))
        ) {
          console.log(`Skipping tab ${tab.id} with URL: ${tab.url || "empty"}`);
          continue;
        }

        const rule = tabRules.tabRules[tab.id];
        try {
          console.log(
            `Processing tab ${tab.id} with URL: ${
              tab.url
            } and rule: ${JSON.stringify(rule)}`
          );
          const tabUrl = new URL(tab.url);
          const tabHost = tabUrl.hostname;

          if (rule.value === "direct") {
            // Add direct connection rule for this tab's hostname
            console.log(`Adding direct connection for ${tabHost}`);
            tabPatterns.push({
              pattern: tabHost,
              proxyType: "direct",
            });
          } else if (rule.value.startsWith("rule_")) {
            // Use a specific domain rule for this tab
            const ruleIndex = parseInt(rule.value.split("_")[1], 10);
            console.log(`Fetching domain rule at index ${ruleIndex}`);

            const domainRules = await getStorageData({ domainRules: [] });

            if (domainRules.domainRules && domainRules.domainRules[ruleIndex]) {
              const domainRule = domainRules.domainRules[ruleIndex];
              console.log(
                `Adding rule for ${tabHost} using domain rule ${domainRule.pattern}`
              );

              // Add this tab's hostname with the selected domain rule's proxy
              tabPatterns.push({
                pattern: tabHost,
                proxyType: domainRule.proxyType,
                server: domainRule.server,
                port: domainRule.port,
                username: domainRule.username,
                password: domainRule.password,
                mtprotoSecret: domainRule.mtprotoSecret,
              });
            } else {
              console.warn(
                `Domain rule at index ${ruleIndex} not found:`,
                domainRules
              );
            }
          }
        } catch (e) {
          console.error(`Error processing tab URL ${tab.url}:`, e);
        }
      }
    }

    console.log(`Generated ${tabPatterns.length} tab patterns for PAC file`);

    // Store tab patterns for PAC generator to use
    await new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set({ tabPatterns }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error storing tab patterns:",
              chrome.runtime.lastError
            );
            reject(chrome.runtime.lastError);
          } else {
            console.log("Tab patterns stored successfully");
            resolve();
          }
        });
      } catch (err) {
        console.error("Exception storing tab patterns:", err);
        reject(err);
      }
    });

    // Regenerate and apply PAC file
    console.log("Regenerating PAC file with tab patterns");
    await generateAndApplyPacFile();

    console.log("Tab-specific proxy settings applied successfully");
    return true;
  } catch (error) {
    console.error("Error applying tab proxies:", error);
    throw error;
  }
}

// Apply proxy for specific tab
async function applyTabProxy(tabId, url) {
  // Early validation
  if (!tabId || !url) {
    console.log("applyTabProxy called without valid tabId or URL");
    return;
  }

  try {
    // Make sure tabRules is always defined with a default empty object
    const tabRules = await getStorageData({ tabRules: {} });

    // Ensure we have a valid tabRules object structure
    if (!tabRules || !tabRules.tabRules) {
      console.warn("Invalid tabRules structure, using empty object", tabRules);
      return;
    }

    // If there's a rule for this tab
    if (tabRules.tabRules[tabId]) {
      const rule = tabRules.tabRules[tabId];
      console.log(`Found rule for tab ${tabId}:`, rule);

      if (!rule || !rule.value) {
        console.warn(`Invalid rule for tab ${tabId}:`, rule);
        return;
      }

      if (rule.value === "direct") {
        // Use direct connection for this tab
        console.log(`Tab ${tabId} using direct connection`);
        // In Manifest V3, we can't set per-tab proxy settings directly
        // We'd need to implement a more complex solution with webRequest API
      } else if (rule.value.startsWith("rule_")) {
        // Use a specific domain rule for this tab
        const ruleIndex = parseInt(rule.value.split("_")[1], 10);
        const domainRules = await getStorageData({ domainRules: [] });

        if (domainRules.domainRules[ruleIndex]) {
          console.log(
            `Tab ${tabId} using rule: ${domainRules.domainRules[ruleIndex].pattern}`
          );
        }
      }
    }
  } catch (error) {
    console.error("Error applying tab proxy:", error);
  }
}

// Helper function to get data from storage
function getStorageData(defaultData) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(defaultData, function (data) {
        if (chrome.runtime.lastError) {
          console.error("Error in getStorageData:", chrome.runtime.lastError);
          // Still resolve with default data rather than rejecting
          resolve(defaultData);
        } else {
          resolve(data);
        }
      });
    } catch (err) {
      console.error("Exception in getStorageData:", err);
      resolve(defaultData); // Use default data on error
    }
  });
}

// Listen for proxy errors
chrome.proxy.onProxyError.addListener(function (details) {
  console.error("Proxy error:", details);
});

// Handle options page settings
async function updateOptionsSettings(settings) {
  // Store settings
  await chrome.storage.sync.set(settings);

  // Apply settings
  if (settings.useCustomPac) {
    // Apply custom PAC script
    await applyCustomPacScript(settings.customPacScript);
  } else {
    // Apply normal settings
    await loadAndApplySettings();
  }

  // Handle WebRTC blocking if enabled
  if (settings.blockWebRTC) {
    await blockWebRTCLeaks();
  } else {
    await restoreWebRTC();
  }
  // Show notification if enabled
  if (settings.showNotifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/notification_icon.png",
      title: "Smart Proxy Switcher",
      message: "Settings updated successfully!",
    });
  }
}

// Apply custom PAC script
async function applyCustomPacScript(script) {
  try {
    await chrome.proxy.settings.set({
      value: {
        mode: "pac_script",
        pacScript: {
          data: script,
        },
      },
      scope: "regular",
    });

    console.log("Custom PAC script applied");
  } catch (error) {
    console.error("Error applying custom PAC script:", error);
    throw error;
  }
}

// Block WebRTC to prevent IP leaks
async function blockWebRTCLeaks() {
  try {
    // Use the privacy API if available
    if (chrome.privacy && chrome.privacy.network) {
      chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "disable_non_proxied_udp",
      });
    }

    console.log("WebRTC IP leaks protection enabled");
  } catch (error) {
    console.error("Error blocking WebRTC leaks:", error);
  }
}

// Restore WebRTC to default behavior
async function restoreWebRTC() {
  try {
    // Use the privacy API if available
    if (chrome.privacy && chrome.privacy.network) {
      chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "default",
      });
    }

    console.log("WebRTC restored to default behavior");
  } catch (error) {
    console.error("Error restoring WebRTC:", error);
  }
}

// Helper function to set up Telegram domain rules for MTProto
async function setupTelegramDomainRules(settings) {
  try {
    // Get current domain rules
    const data = await getStorageData({ domainRules: [] });
    let domainRules = data.domainRules || [];

    // Remove any existing Telegram rules
    domainRules = domainRules.filter(
      (rule) =>
        !(rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
    );

    // Add rules for common Telegram domains
    const telegramDomains = [
      "*.telegram.org",
      "telegram.org",
      "web.telegram.org",
      "*.t.me",
      "t.me",
    ];

    // Add each domain as a separate rule
    telegramDomains.forEach((domain) => {
      domainRules.push({
        pattern: domain,
        proxyType: "mtproto",
        server: settings.server,
        port: settings.port,
        username: "",
        password: "",
        mtprotoSecret: settings.mtprotoSecret,
      });
    });

    // Save the updated rules
    await chrome.storage.sync.set({ domainRules });
    console.log("Added automatic rules for Telegram domains");

    // Apply the updated rules
    await generateAndApplyPacFile();
  } catch (error) {
    console.error("Error setting up Telegram domain rules:", error);
  }
}
