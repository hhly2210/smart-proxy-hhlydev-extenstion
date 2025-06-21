// Background script for handling proxy configuration
// This runs as a service worker in Manifest V3

// Initialize proxy settings when extension is installed or updated
chrome.runtime.onInstalled.addListener(function () {
  loadAndApplySettings();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("Received message with action:", request.action);

  // Log source of message if available
  if (sender && sender.tab) {
    console.log("Message from tab:", sender.tab.url);
  }

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
  if (request.action === "runDiagnostics") {
    runProxyDiagnostics()
      .then(() => safeResponse(true))
      .catch((error) => {
        console.error("Error in runDiagnostics:", error);
        safeResponse(false, error);
      });

    return true;
  }
  if (request.action === "reloadTelegramProxy") {
    reloadTelegramProxySettings()
      .then((result) => safeResponse(result))
      .catch((error) => {
        console.error("Error in reloadTelegramProxy:", error);
        safeResponse(false, error);
      });

    return true;
  }
  if (request.action === "testTelegramConnectivity") {
    testTelegramConnectivity();
    sendResponse({ success: true });
    return false;
  }
  if (request.action === "diagnoseMTProtoSupport") {
    diagnosticMTProtoSupport()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Error in diagnoseMTProtoSupport:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error",
        });
      });
    return true;
  }
  if (request.action === "convertMTProtoToSOCKS5") {
    convertMTProtoToSOCKS5()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Error converting MTProto to SOCKS5:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error",
        });
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

      // Ensure the secret key is properly formatted
      let secretKey = settings.mtprotoSecret.trim();

      // Remove any 'dd' prefix if present (some MTProto configurations use this)
      if (secretKey.startsWith("dd")) {
        secretKey = secretKey.substring(2);
      }

      // Ensure it's using the proper format (hexadecimal)
      if (!/^[0-9a-fA-F]+$/.test(secretKey)) {
        console.warn(
          "MTProto secret key appears to be in non-hexadecimal format"
        );
      }

      // Store MTProto settings
      chrome.storage.local.set({
        mtprotoActive: true,
        mtprotoDetails: {
          server: settings.server,
          port: settings.port,
          secret: secretKey,
          timestamp: Date.now(), // Add timestamp for debugging
        },
      });

      // Set up Telegram domains with the MTProto proxy
      setupTelegramDomainRules(settings);

      console.log("MTProto proxy settings saved with secret key");

      // Log success notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/notification_icon.png",
        title: "Smart Proxy Switcher",
        message: "MTProto proxy configured for Telegram",
      });
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
    
    // Extract hostname from URL if needed
    function extractHostname(url) {
      // Already a hostname without protocol
      if (!url.includes('://')) return url;
      
      // Remove protocol
      let hostname = url.split('://')[1];
      
      // Remove path, query, etc.
      hostname = hostname.split('/')[0].split('?')[0].split('#')[0];
      
      // Remove port if present
      if (hostname.includes(':')) {
        hostname = hostname.split(':')[0];
      }
      
      return hostname;
    }
    
    // When host parameter is actually a full URL, extract the hostname
    if (host.includes('://')) {
      host = extractHostname(host);
    }
    
    // Helper function to check if a host matches a pattern
    function hostMatchesPattern(host, patternStr) {
      if (!patternStr) return false;
      
      // Handle multiple patterns separated by semicolons
      if (patternStr.includes(';')) {
        const patterns = patternStr.split(';').map(p => p.trim()).filter(p => p.length > 0);
        return patterns.some(pattern => checkSinglePattern(host, pattern));
      }
      
      // Regular single pattern
      return checkSinglePattern(host, patternStr);
    }
    
    // Check if host matches a single pattern
    function checkSinglePattern(host, pattern) {
      // Empty pattern check
      if (!pattern) return false;
      
      // Handle wildcard patterns (*.domain.tld)
      if (pattern.startsWith("*.")) {
        const domainPart = pattern.substring(2);
        return host === domainPart || host.endsWith("." + domainPart);
      }
      
      // Exact match check
      if (host === pattern) return true;
      
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
        // MTProto is not natively supported by browsers, so using SOCKS5 as transport
        console.log("Converting MTProto to SOCKS5 for browser compatibility");
        proxyString = `SOCKS5 ${tabRule.server}:${tabRule.port}`;

        // Save information about the conversion for diagnostics
        chrome.storage.local.set({
          mtprotoConverted: true,
          mtprotoConversionNote:
            "MTProto was converted to SOCKS5 at " + new Date().toISOString(),
        });

        const isTelegramPattern =
          tabRule.pattern.includes("telegram.org") ||
          tabRule.pattern.includes("t.me");

        if (isTelegramPattern) {
          // Force setting mtprotoActive flag for Telegram domains in tabs
          chrome.storage.local.set({
            mtprotoActive: true,
            mtprotoDetails: {
              server: tabRule.server,
              port: tabRule.port,
              secret: tabRule.mtprotoSecret || "",
              timestamp: Date.now(),
              source: "tab_rule",
            },
          });

          // Use a more comprehensive rule for Telegram domains with exact host matches too
          pacScript += `
    // Telegram tab rule - handles all Telegram domains
    if (host === "web.telegram.org" ||
        host === "telegram.org" ||
        host.endsWith(".telegram.org") ||
        host === "t.me" ||
        host.endsWith(".t.me") ||
        hostMatchesPattern(host, "*.telegram.org") || 
        hostMatchesPattern(host, "telegram.org") || 
        hostMatchesPattern(host, "web.telegram.org") || 
        hostMatchesPattern(host, "*.t.me") || 
        hostMatchesPattern(host, "t.me")) {
      if (typeof console !== 'undefined') {
        console.log("MTProto proxy applied for Telegram tab: " + host);
      }
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
      } // Add tab rule to PAC script - ASCII ONLY, no console.log
      if (proxyString) {
        pacScript += `
    
    // Tab rule
    if (hostMatchesPattern(host, "${tabRule.pattern}")) {
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
      // MTProto is not directly supported by browsers, using SOCKS5 as transport
      console.log(
        "Domain rule: Converting MTProto to SOCKS5 for browser compatibility"
      );
      proxyString = `SOCKS5 ${rule.server}:${rule.port}`;

      // Save information about the conversion for diagnostics
      chrome.storage.local.set({
        mtprotoConverted: true,
        mtprotoConversionNote:
          "MTProto domain rule was converted to SOCKS5 at " +
          new Date().toISOString(),
      });

      const isTelegramPattern =
        rule.pattern.includes("telegram.org") || rule.pattern.includes("t.me");

      if (isTelegramPattern) {
        console.log("Setting up MTProto proxy for Telegram domains");
        // Force setting mtprotoActive flag for Telegram domains
        chrome.storage.local.set({
          mtprotoActive: true,
          mtprotoDetails: {
            server: rule.server,
            port: rule.port,
            secret: rule.mtprotoSecret || "",
            timestamp: Date.now(),
          },
        });

        // Enhanced Telegram domain handling with more explicit rules and debug info
        pacScript += `
    // Telegram MTProto rule - comprehensive matching for all Telegram domains
    if (hostMatchesPattern(host, "${rule.pattern}") || 
        hostMatchesPattern(host, "*.telegram.org") ||
        hostMatchesPattern(host, "telegram.org") || 
        hostMatchesPattern(host, "web.telegram.org") || 
        host === "web.telegram.org" ||
        host === "telegram.org" ||
        host.endsWith(".telegram.org") ||
        hostMatchesPattern(host, "*.t.me") ||
        hostMatchesPattern(host, "t.me") ||
        host === "t.me" ||
        host.endsWith(".t.me")) {
      // Debug info within PAC script
      if (typeof console !== 'undefined') {
        console.log("MTProto proxy applied for Telegram domain: " + host);
      }
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
      console.log(
        "Default proxy: Converting MTProto to SOCKS5 for browser compatibility"
      );
      defaultProxyString = `SOCKS5 ${settings.server}:${settings.port}`;

      // Save information about the conversion
      chrome.storage.local.set({
        mtprotoConverted: true,
        mtprotoConversionNote:
          "Default MTProto was converted to SOCKS5 at " +
          new Date().toISOString(),
      });
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
  // Check if we need to handle MTProto settings specially
  const needsMTProtoActivation =
    settings.mtprotoEnabled === true ||
    (settings.domainRules &&
      settings.domainRules.some(
        (rule) =>
          rule.proxyType === "mtproto" &&
          (rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
      ));

  // Apply settings
  if (settings.useCustomPac) {
    // Apply custom PAC script
    await applyCustomPacScript(settings.customPacScript);
  } else {
    // Apply normal settings
    await loadAndApplySettings();
  }

  // Ensure MTProto is activated if needed
  if (needsMTProtoActivation) {
    // Get current domain rules to find MTProto config
    const mtprotoRules = await getStorageData({ domainRules: [] });
    const telegramRule =
      mtprotoRules.domainRules &&
      mtprotoRules.domainRules.find(
        (rule) =>
          rule.proxyType === "mtproto" &&
          (rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
      );

    if (telegramRule) {
      console.log("Found MTProto rule, ensuring it's active");

      // Ensure MTProto proxy is active
      chrome.storage.local.set({
        mtprotoActive: true,
        mtprotoDetails: {
          server: telegramRule.server,
          port: telegramRule.port,
          secret: telegramRule.mtprotoSecret || "",
          timestamp: Date.now(),
          source: "options_activation",
        },
      });

      // Apply PAC file specifically
      await generateAndApplyPacFile();
    }
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
    // Check for non-ASCII characters that could cause Chrome to reject the PAC script
    const hasNonAscii = /[^\x00-\x7F]/.test(script);
    if (hasNonAscii) {
      console.warn(
        "PAC script contains non-ASCII characters. Removing them..."
      );
      script = script.replace(/[^\x00-\x7F]/g, "");
    }

    // Add safeguards for error handling within the PAC script
    if (!script.includes("try {") && !script.includes("catch(")) {
      // Wrap the core PAC logic in try-catch to prevent total failure
      const scriptParts = script.split("function FindProxyForURL(url, host)");
      if (scriptParts.length > 1) {
        script =
          scriptParts[0] +
          "function FindProxyForURL(url, host) {\n  try {" +
          scriptParts[1].replace(
            /}(\s*)$/,
            '  } catch(e) {\n    console.error("PAC script error:", e);\n    return "DIRECT";\n  }\n}'
          );
      }
    }

    await chrome.proxy.settings.set({
      value: {
        mode: "pac_script",
        pacScript: {
          data: script,
        },
      },
      scope: "regular",
    });

    console.log("Custom PAC script applied successfully");
  } catch (error) {
    console.error("Error applying custom PAC script:", error);

    // Fallback to direct connection
    try {
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular",
      });
      console.log("Fallback to direct connection due to PAC script error");
    } catch (fallbackError) {
      console.error("Error setting fallback direct connection:", fallbackError);
    }

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
    ); // All Telegram domains in one comprehensive pattern
    // This pattern will be split by semicolons and processed individually in PAC script
    const telegramPattern =
      "*.telegram.org; telegram.org; web.telegram.org; k.telegram.org; core.telegram.org; api.telegram.org; *.t.me; t.me";

    console.log(
      "Setting up MTProto proxy for all Telegram domains with pattern: " +
        telegramPattern
    );

    // Add one rule that covers all Telegram domains
    domainRules.push({
      pattern: telegramPattern,
      proxyType: "mtproto",
      server: settings.server,
      port: settings.port,
      username: "",
      password: "",
      mtprotoSecret: settings.mtprotoSecret,
    });

    // Save the updated rules
    await chrome.storage.sync.set({ domainRules });
    console.log("Added automatic rules for Telegram domains");

    // Apply the updated rules immediately
    await generateAndApplyPacFile();

    // Notify about updated Telegram settings
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/notification_icon.png",
      title: "Smart Proxy Switcher",
      message: "MTProto proxy configured for Telegram domains",
    });
  } catch (error) {
    console.error("Error setting up Telegram domain rules:", error);
  }
}

// Helper function to process multi-domain patterns (separated by semicolons)
function processDomainPatterns(pattern, handler) {
  if (!pattern) return;

  if (pattern.includes(";")) {
    // Handle multiple patterns separated by semicolons
    const patterns = pattern
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.length > 0); // Filter out empty patterns

    console.log(
      `Processing multiple domain patterns (${patterns.length}): ${pattern}`
    );

    // Process each pattern individually
    patterns.forEach((singlePattern) => {
      if (singlePattern.length > 0) {
        handler(singlePattern);
      }
    });
  } else {
    // Handle single pattern
    console.log(`Processing single domain pattern: ${pattern}`);
    handler(pattern);
  }
}

// Test function to verify domain pattern handling with Telegram domains
function testTelegramProxyHandling() {
  console.log("=== Testing Telegram Domain Handling ===");

  // Example Telegram domains
  const telegramDomains = [
    "telegram.org",
    "web.telegram.org",
    "core.telegram.org",
    "api.telegram.org",
    "desktop.telegram.org",
    "t.me",
    "tx.me",
  ];

  // Function similar to the one used in PAC script to test matching
  function hostMatchesPattern(host, patternStr) {
    // Handle multiple patterns separated by semicolons
    if (patternStr.includes(";")) {
      const patterns = patternStr
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      return patterns.some((pattern) => checkSinglePattern(host, pattern));
    }

    // Regular single pattern
    return checkSinglePattern(host, patternStr);
  }

  function checkSinglePattern(host, pattern) {
    if (!pattern) return false;

    // Handle wildcard patterns (*.domain.tld)
    if (pattern.startsWith("*.")) {
      const domainPart = pattern.substring(2);
      return host === domainPart || host.endsWith("." + domainPart);
    }

    // Exact match check
    if (host === pattern) return true;

    // Convert wildcards to regex safely
    const regexText = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
    const regex = new RegExp("^" + regexText + "$");
    return regex.test(host);
  }

  // Test pattern matching
  const testPattern =
    "*.telegram.org; telegram.org; web.telegram.org; *.t.me; t.me";
  console.log("Testing pattern:", testPattern);

  telegramDomains.forEach((domain) => {
    const matches = hostMatchesPattern(domain, testPattern);
    console.log(
      `Domain "${domain}" ${matches ? "MATCHES" : "DOES NOT MATCH"} pattern`
    );
  });

  console.log("=== Test Complete ===");
}

// Call test function on extension startup
(async function () {
  // Small delay to ensure extension is fully loaded
  await new Promise((resolve) => setTimeout(resolve, 2000));
  testTelegramProxyHandling();
})();

// Listen for web requests to Telegram domains to validate proxy usage
chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    // Check if this is a Telegram domain
    const url = new URL(details.url);
    const host = url.hostname;

    if (host.includes("telegram") || host.includes("t.me")) {
      console.log(`Detected request to Telegram domain: ${host}`);

      // Check if we have an MTProto proxy configured and ensure it's active
      chrome.storage.local.get(
        ["mtprotoActive", "mtprotoDetails"],
        function (result) {
          if (result.mtprotoActive) {
            console.log(
              `MTProto proxy is active for this Telegram request to ${host}`,
              result.mtprotoDetails
            );
          } else {
            console.log(
              `No MTProto proxy active for Telegram request to ${host}, checking for rules`
            );

            // Try to find and activate MTProto rules
            chrome.storage.sync.get({ domainRules: [] }, function (data) {
              const telegramRules = data.domainRules.filter(
                (rule) =>
                  rule.proxyType === "mtproto" &&
                  (rule.pattern.includes("telegram") ||
                    rule.pattern.includes("t.me"))
              );

              if (telegramRules.length > 0) {
                const rule = telegramRules[0];
                console.log(
                  "Found MTProto rule for Telegram, activating:",
                  rule
                );

                // Activate MTProto proxy
                chrome.storage.local.set(
                  {
                    mtprotoActive: true,
                    mtprotoDetails: {
                      server: rule.server,
                      port: rule.port,
                      secret: rule.mtprotoSecret || "",
                      timestamp: Date.now(),
                      source: "web_request_activation",
                    },
                  },
                  function () {
                    console.log("MTProto proxy activated from web request");

                    // Force regenerate and apply PAC file
                    generateAndApplyPacFile().catch((err) =>
                      console.error(
                        "Error regenerating PAC file from web request:",
                        err
                      )
                    );
                  }
                );
              } else {
                console.log("No MTProto rules found for Telegram domains");
              }
            });
          }
        }
      );
    }

    // This is just logging, don't block or modify the request
    return { cancel: false };
  },
  // Filter for Telegram domains
  {
    urls: [
      "*://*.telegram.org/*",
      "*://telegram.org/*",
      "*://*.t.me/*",
      "*://t.me/*",
    ],
  },
  // No extra info needed
  []
);

// Add diagnostic tool to help users troubleshoot connection issues
async function runProxyDiagnostics() {
  console.log("=== Running Proxy Diagnostics ===");

  try {
    // Check current proxy settings
    const proxySettings = await chrome.proxy.settings.get({});
    console.log("Current proxy settings:", proxySettings);

    // Display PAC data if it's being used
    if (
      proxySettings &&
      proxySettings.value &&
      proxySettings.value.mode === "pac_script"
    ) {
      console.log(
        "Using PAC script mode - this is correct for domain/tab rules"
      );
      // We can't directly access the PAC script content due to security restrictions
    }

    // Check if we have MTProto settings
    const mtprotoData = await new Promise((resolve) => {
      chrome.storage.local.get(["mtprotoActive", "mtprotoDetails"], resolve);
    });

    // Force activate MTProto for Telegram if needed
    let needsReload = false;

    // Load domain rules to check for Telegram configuration
    const domainData = await new Promise((resolve) => {
      chrome.storage.sync.get({ domainRules: [] }, resolve);
    });

    const telegramRules = domainData.domainRules.filter(
      (rule) =>
        rule.pattern.includes("telegram") || rule.pattern.includes("t.me")
    );

    if (telegramRules.length > 0) {
      // We have Telegram rules, ensure MTProto is active
      console.log("Found Telegram domain rules:", telegramRules);

      const telegramRule = telegramRules[0]; // Use first rule we find

      if (!mtprotoData.mtprotoActive) {
        console.log("MTProto proxy was NOT active, activating now");

        // Activate MTProto proxy for Telegram
        chrome.storage.local.set({
          mtprotoActive: true,
          mtprotoDetails: {
            server: telegramRule.server,
            port: telegramRule.port,
            secret: telegramRule.mtprotoSecret || "",
            timestamp: Date.now(),
            source: "diagnostics_activation",
          },
        });

        needsReload = true;
      } else {
        console.log(
          "MTProto proxy is ACTIVE with details:",
          mtprotoData.mtprotoDetails
        );
      }
    } else {
      if (mtprotoData.mtprotoActive) {
        console.log(
          "MTProto proxy is ACTIVE with details but no Telegram rules found:",
          mtprotoData.mtprotoDetails
        );
      } else {
        console.log("MTProto proxy is NOT active and no Telegram rules found");
      }
    }

    // Check tab-specific rules
    const tabData = await new Promise((resolve) => {
      chrome.storage.local.get({ tabPatterns: [] }, resolve);
    });

    const telegramTabRules = tabData.tabPatterns.filter(
      (rule) =>
        rule.pattern.includes("telegram") || rule.pattern.includes("t.me")
    );

    if (telegramTabRules.length > 0) {
      console.log("Found Telegram tab rules:", telegramTabRules);
    } // Test domain pattern matching for key Telegram domains
    console.log("Testing pattern matching for Telegram domains:");

    // Make sure telegramRules exists before using it
    if (telegramRules && telegramRules.length > 0) {
      ["web.telegram.org", "t.me", "api.telegram.org"].forEach((domain) => {
        console.log(`Testing domain: ${domain}`);

        // Using same matching logic as in PAC script
        telegramRules.forEach((rule) => {
          // Use the same function as in the PAC script for consistency
          function hostMatchesPattern(host, patternStr) {
            // Handle multiple patterns separated by semicolons
            if (patternStr && patternStr.includes(";")) {
              const patterns = patternStr
                .split(";")
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
              return patterns.some((pattern) =>
                checkSinglePattern(host, pattern)
              );
            }

            // Regular single pattern
            return checkSinglePattern(host, patternStr);
          }

          function checkSinglePattern(host, pattern) {
            if (!pattern) return false;

            // Handle wildcard patterns (*.domain.tld)
            if (pattern.startsWith("*.")) {
              const domainPart = pattern.substring(2);
              return host === domainPart || host.endsWith("." + domainPart);
            }

            // Exact match check
            if (host === pattern) return true;

            // Convert wildcards to regex safely
            const regexText = pattern
              .replace(/\./g, "\\.")
              .replace(/\*/g, ".*");
            const regex = new RegExp("^" + regexText + "$");
            return regex.test(host);
          }

          const matches = hostMatchesPattern(domain, rule.pattern);

          console.log(
            `  Rule pattern "${rule.pattern}" ${
              matches ? "MATCHES" : "DOES NOT MATCH"
            } domain`
          );
        });
      });
    } else {
      console.log("No Telegram rules found to test domain patterns against");
    }

    // Check if we need to refresh PAC file
    if (needsReload) {
      console.log("Regenerating PAC file after MTProto activation");
      await generateAndApplyPacFile();

      // Test Telegram connectivity
      setTimeout(testTelegramConnectivity, 1000);
    }

    console.log("=== Diagnostics Complete ===");
  } catch (error) {
    console.error("Error in proxy diagnostics:", error);
  }
}

// Run diagnostics on demand via message
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "runDiagnostics") {
    runProxyDiagnostics()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
});

// Function to test connectivity to Telegram domains
function testTelegramConnectivity() {
  console.log("=== Testing Telegram Connectivity ===");
  const telegramUrls = [
    "https://web.telegram.org/k/",
    "https://telegram.org/",
    "https://api.telegram.org/",
  ];

  // First, check if MTProto is actually active
  chrome.storage.local.get(
    ["mtprotoActive", "mtprotoDetails"],
    function (data) {
      console.log(
        "MTProto status:",
        data.mtprotoActive ? "Active" : "Inactive"
      );
      if (data.mtprotoDetails) {
        console.log("MTProto details:", {
          server: data.mtprotoDetails.server,
          port: data.mtprotoDetails.port,
          secretLength: data.mtprotoDetails.secret
            ? data.mtprotoDetails.secret.length
            : 0,
          lastActivated: new Date(data.mtprotoDetails.timestamp),
        });
      }
    }
  );

  // Check current proxy settings
  chrome.proxy.settings.get({}, function (config) {
    console.log("Current proxy configuration:", JSON.stringify(config));
  });

  // Log active proxy settings to console
  console.log("Attempting to debug proxy configuration:");
  try {
    chrome.webRequest.onBeforeRequest.addListener(
      function (details) {
        // Only log for Telegram domains
        if (details.url.includes("telegram.org")) {
          console.log(`Telegram Request: ${details.url}`);
          console.log(`Request details:`, {
            method: details.method,
            type: details.type,
            fromCache: details.fromCache,
            statusCode: details.statusCode,
            timeStamp: new Date(details.timeStamp),
          });
          return { cancel: false };
        }
      },
      { urls: ["*://*.telegram.org/*"] },
      ["requestBody"]
    );

    chrome.webRequest.onCompleted.addListener(
      function (details) {
        if (details.url.includes("telegram.org")) {
          console.log(`Telegram Response: ${details.url}`);
          console.log(`Response status: ${details.statusCode}`);
        }
      },
      { urls: ["*://*.telegram.org/*"] }
    );

    chrome.webRequest.onErrorOccurred.addListener(
      function (details) {
        if (details.url.includes("telegram.org")) {
          console.log(`Telegram Error: ${details.url}`);
          console.log(`Error: ${details.error}`);
        }
      },
      { urls: ["*://*.telegram.org/*"] }
    );
  } catch (error) {
    console.error("Error setting up webRequest listeners:", error);
  }

  // Legacy fetch test
  telegramUrls.forEach((url) => {
    console.log(`Testing connection to ${url}`);
    fetch(url, {
      method: "HEAD",
      headers: { "Cache-Control": "no-cache" },
      mode: "no-cors", // This is important for cross-origin requests to not fail
    })
      .then((response) => {
        console.log(`Connection to ${url} successful!`);
      })
      .catch((error) => {
        console.error(`Failed to fetch ${url}:`, error);
      });
  });

  console.log("=== Connectivity Test Initiated ===");
}

// Function to reload proxy settings for Telegram
async function reloadTelegramProxySettings() {
  console.log("=== Reloading Telegram Proxy Settings ===");

  try {
    // Get domain rules
    const domainData = await getStorageData({ domainRules: [] });

    // Find Telegram rules (check for both MTProto and SOCKS5)
    const telegramRules = domainData.domainRules.filter(
      (rule) =>
        (rule.proxyType === "mtproto" || rule.proxyType === "socks5") &&
        (rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
    );

    if (telegramRules.length > 0) {
      const rule = telegramRules[0];
      console.log("Found proxy rule for Telegram, reactivating:", rule);

      // Ensure proxy is properly configured
      if (rule.server && rule.port) {
        if (rule.proxyType === "mtproto") {
          // Format secret key properly if present
          let secretKey = rule.mtprotoSecret || "";
          if (secretKey.startsWith("dd")) {
            secretKey = secretKey.substring(2);
          }

          // Activate MTProto proxy
          await new Promise((resolve) => {
            chrome.storage.local.set(
              {
                mtprotoActive: true,
                mtprotoDetails: {
                  server: rule.server,
                  port: rule.port,
                  secret: secretKey,
                  timestamp: Date.now(),
                  source: "reload_function",
                },
              },
              resolve
            );
          });

          console.log("MTProto proxy reactivated");

          // Add browser compatibility warning
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/notification_icon.png",
            title: "MTProto Proxy Warning",
            message:
              "Browser limitations may prevent MTProto proxies from working with Telegram web. Consider using SOCKS5 instead.",
          });
        } else {
          // For SOCKS5, just log it
          console.log("SOCKS5 proxy for Telegram reactivated");

          // Clear MTProto settings to avoid confusion
          await new Promise((resolve) => {
            chrome.storage.local.set({ mtprotoActive: false }, resolve);
          });
        }

        // Regenerate PAC file with forced Telegram rules
        await generateAndApplyPacFile();

        console.log("PAC file regenerated with Telegram rules");

        // Show notification
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/notification_icon.png",
          title: "Smart Proxy Switcher",
          message: "Telegram proxy settings reloaded and applied",
        });

        // Test connectivity after a short delay
        setTimeout(() => {
          testTelegramConnectivity();
          addTelegramRulesIfMissing(); // Ensure we have rules for all Telegram domains
        }, 2000);

        return true;
      } else {
        console.error("Invalid proxy configuration for Telegram");
        return false;
      }
    } else {
      console.log("No Telegram proxy rules found");

      // Suggest creating a SOCKS5 rule for Telegram
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/notification_icon.png",
        title: "Telegram Proxy Setup",
        message:
          "No proxy rules found for Telegram. Consider adding a SOCKS5 rule for better browser compatibility.",
      });

      return false;
    }
  } catch (error) {
    console.error("Error reloading Telegram proxy settings:", error);
    return false;
  }
}

// Function to diagnose MTProto proxy support and limitations
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "diagnoseMTProtoSupport") {
    diagnosticMTProtoSupport()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Error in diagnoseMTProtoSupport:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error",
        });
      });
    return true;
  }
});

// Function to diagnose MTProto support status
async function diagnosticMTProtoSupport() {
  console.log("=== Diagnosing MTProto Support ===");

  const result = {
    browserInfo: navigator.userAgent,
    chromeVersion:
      /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1] || "unknown",
    proxySupport: {
      mtproto: false,
      socks5: true,
      http: true,
      https: true,
    },
    mtprotoActive: false,
    currentConfig: null,
    pacScriptStatus: null,
    telegramRules: [],
    recommendation: "",
  };

  // Check MTProto active status
  try {
    const data = await getStorageData({
      mtprotoActive: false,
      mtprotoDetails: null,
    });
    result.mtprotoActive = data.mtprotoActive || false;
    result.mtprotoDetails = data.mtprotoDetails
      ? {
          server: data.mtprotoDetails.server,
          port: data.mtprotoDetails.port,
          secretProvided: !!data.mtprotoDetails.secret,
          lastActivated: new Date(data.mtprotoDetails.timestamp).toISOString(),
        }
      : null;
  } catch (error) {
    console.error("Error checking MTProto status:", error);
  }

  // Get current proxy config
  try {
    const config = await new Promise((resolve) => {
      chrome.proxy.settings.get({}, resolve);
    });
    result.currentConfig = config.value.mode;

    if (config.value.mode === "pac_script") {
      result.pacScriptStatus = config.value.pacScript ? "Present" : "Missing";
      // Extract portion of PAC script dealing with Telegram
      if (config.value.pacScript && config.value.pacScript.data) {
        const pacData = config.value.pacScript.data;
        const telegramMatches = pacData.match(/telegram\.org|t\.me/g);
        result.telegramPacMatches = telegramMatches
          ? telegramMatches.length
          : 0;
      }
    }
  } catch (error) {
    console.error("Error getting proxy config:", error);
  }

  // Get domain rules for Telegram
  try {
    const domainData = await getStorageData({ domainRules: [] });
    result.telegramRules = domainData.domainRules
      .filter(
        (rule) =>
          rule.pattern.includes("telegram") || rule.pattern.includes("t.me")
      )
      .map((rule) => ({
        pattern: rule.pattern,
        type: rule.proxyType,
      }));
  } catch (error) {
    console.error("Error getting domain rules:", error);
  }

  // Browser limitations
  result.recommendation =
    "Chrome and other browsers don't natively support MTProto protocol for website " +
    "connections. While we're using SOCKS5 as a transport in the PAC script, the MTProto protocol itself " +
    "requires special handling that browsers don't provide. For Telegram Web, you may need to use " +
    "a regular SOCKS5 proxy instead that's compatible with MTProto, or use the Telegram desktop app " +
    "which supports MTProto proxies directly.";

  console.log("Diagnostic result:", result);
  return result;
}

// Helper function to ensure all Telegram domains are covered with the correct proxy type
async function addTelegramRulesIfMissing() {
  try {
    console.log("Checking for complete Telegram domain coverage");

    // Get current domain rules
    const domainData = await getStorageData({ domainRules: [] });

    // Check if we have any rules for Telegram domains
    const telegramRules = domainData.domainRules.filter(
      (rule) =>
        rule.pattern.includes("telegram") || rule.pattern.includes("t.me")
    );

    if (telegramRules.length === 0) {
      console.log("No Telegram rules found, will not add any");
      return;
    }

    // Use the first found Telegram rule as a template
    const templateRule = telegramRules[0];

    // Comprehensive list of Telegram domains
    const allTelegramDomains = [
      "*.telegram.org",
      "telegram.org",
      "*.t.me",
      "t.me",
      "*.telesco.pe",
      "telesco.pe",
      "*.tdesktop.com",
      "tdesktop.com",
    ];

    // Create a pattern string with all domains
    const fullPattern = allTelegramDomains.join("; ");

    // Check if we already have a rule with this complete pattern
    const hasCompleteRule = telegramRules.some(
      (rule) =>
        rule.pattern.split(";").length >= allTelegramDomains.length ||
        rule.pattern === fullPattern
    );

    if (hasCompleteRule) {
      console.log("Complete Telegram domain coverage already exists");
      return;
    }

    console.log("Creating comprehensive Telegram domain rule");

    // Create a new comprehensive rule based on the template
    const newRule = {
      pattern: fullPattern,
      proxyType:
        templateRule.proxyType === "mtproto"
          ? "socks5"
          : templateRule.proxyType, // Prefer SOCKS5 over MTProto
      server: templateRule.server,
      port: templateRule.port,
      username: templateRule.username || "",
      password: templateRule.password || "",
    };

    // If the original was MTProto, but we're switching to SOCKS5, show a notification
    if (templateRule.proxyType === "mtproto") {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/notification_icon.png",
        title: "Proxy Type Changed",
        message:
          "Switched from MTProto to SOCKS5 for better browser compatibility with Telegram web.",
      });

      console.log("Switched from MTProto to SOCKS5 for better compatibility");
    }

    // Remove old Telegram rules and add the comprehensive one
    const updatedRules = domainData.domainRules.filter(
      (rule) =>
        !(rule.pattern.includes("telegram") || rule.pattern.includes("t.me"))
    );
    updatedRules.push(newRule);

    // Save updated rules
    await new Promise((resolve) => {
      chrome.storage.sync.set({ domainRules: updatedRules }, resolve);
    });

    console.log("Updated domain rules with comprehensive Telegram coverage");

    // Apply the updated rules
    await generateAndApplyPacFile();
  } catch (error) {
    console.error("Error updating Telegram rules:", error);
  }
}

// Handle message to convert MTProto rules to SOCKS5
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "convertMTProtoToSOCKS5") {
    convertMTProtoToSOCKS5()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Error converting MTProto to SOCKS5:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error",
        });
      });
    return true;
  }
});

// Function to convert MTProto rules to SOCKS5 for better compatibility
async function convertMTProtoToSOCKS5() {
  console.log("=== Converting MTProto rules to SOCKS5 ===");

  try {
    // Get current domain rules
    const domainData = await getStorageData({ domainRules: [] });

    // Check for MTProto rules
    const mtprotoRules = domainData.domainRules.filter(
      (rule) => rule.proxyType === "mtproto"
    );

    if (mtprotoRules.length === 0) {
      console.log("No MTProto rules found to convert");
      return { converted: 0, message: "No MTProto rules found" };
    }

    console.log(`Found ${mtprotoRules.length} MTProto rules to convert`);

    // Convert MTProto rules to SOCKS5
    const updatedRules = domainData.domainRules.map((rule) => {
      if (rule.proxyType === "mtproto") {
        // Create a copy with SOCKS5 instead of MTProto
        return {
          ...rule,
          proxyType: "socks5",
          // Add note that this was converted from MTProto
          notes: `Converted from MTProto on ${new Date().toISOString()}`,
        };
      }
      return rule;
    });

    // Save updated rules
    await new Promise((resolve) => {
      chrome.storage.sync.set({ domainRules: updatedRules }, resolve);
    });

    console.log(
      `Successfully converted ${mtprotoRules.length} MTProto rules to SOCKS5`
    );

    // Also check general settings for MTProto
    const settings = await getStorageData({
      enabled: false,
      proxyType: "http",
    });

    let generalUpdated = false;

    if (settings.proxyType === "mtproto") {
      // Update general settings to use SOCKS5 instead
      settings.proxyType = "socks5";

      await new Promise((resolve) => {
        chrome.storage.sync.set(settings, resolve);
      });

      generalUpdated = true;
      console.log("Updated general settings from MTProto to SOCKS5");
    }

    // Regenerate PAC script with updated rules
    await generateAndApplyPacFile();

    // Clear MTProto active flag
    await new Promise((resolve) => {
      chrome.storage.local.set({ mtprotoActive: false }, resolve);
    });

    return {
      converted: mtprotoRules.length,
      generalUpdated,
      message: `Successfully converted ${mtprotoRules.length} rules to SOCKS5 for better browser compatibility`,
    };
  } catch (error) {
    console.error("Error converting MTProto to SOCKS5:", error);
    throw error;
  }
}
