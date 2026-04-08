const sections = {
  install: { title: "\u5b89\u88c5\u534f\u8bae", heading: "\u5b89\u88c5\u534f\u8bae", command: "POST /api/install" },
  core: { title: "\u6838\u5fc3\u7248\u672c", heading: "\u6838\u5fc3\u7248\u672c", command: "GET /api/cores | POST /api/core/update" },
  uninstall: { title: "\u5378\u8f7d\u534f\u8bae", heading: "\u5378\u8f7d\u534f\u8bae", command: "GET /api/protocols | POST /api/uninstall" },
  users: { title: "\u7528\u6237\u7ba1\u7406", heading: "\u7528\u6237\u7ba1\u7406", command: "GET /api/users | POST|DELETE /api/users" },
  subscription: { title: "\u8ba2\u9605\u670d\u52a1", heading: "\u8ba2\u9605\u670d\u52a1", command: "GET /api/subscriptions | POST /api/subscriptions/update" },
  routing: { title: "\u5206\u6d41\u89c4\u5219", heading: "\u5206\u6d41\u89c4\u5219", command: "GET /api/routing | POST|DELETE /api/routing" },
};

const protocolDefaults = {
  vless: { port: "443", core: "Xray", transport: "reality" },
  "vless-xhttp": { port: "8443", core: "Xray", transport: "xhttp" },
  trojan: { port: "8443", core: "Xray", transport: "tls" },
  "vmess-ws": { port: "8080", core: "Xray", transport: "ws" },
  hy2: { port: "9443", core: "Sing-box", transport: "quic" },
  tuic: { port: "10443", core: "Sing-box", transport: "quic" },
};

const realityServerNames = [
  "developer.apple.com",
  "www.microsoft.com",
  "www.cloudflare.com",
  "www.amazon.com",
  "www.google.com",
  "www.github.com",
];

const statusText = {
  running: "\u8fd0\u884c\u4e2d",
  enabled: "\u5df2\u542f\u7528",
  warning: "\u544a\u8b66",
  disabled: "\u5df2\u505c\u7528",
  manual: "\u624b\u52a8",
  unknown: "\u672a\u77e5",
};

const sectionText = {
  install: {
    menuTitle: "\u5b89\u88c5\u534f\u8bae",
    menuSmall: "Reality / WS / Hy2 / TUIC",
  },
  core: {
    menuTitle: "\u6838\u5fc3\u7248\u672c\u7ba1\u7406",
    menuSmall: "Xray / Sing-box / Snell",
  },
  uninstall: {
    menuTitle: "\u5378\u8f7d\u534f\u8bae",
    menuSmall: "\u6309\u534f\u8bae\u4e0e\u7aef\u53e3\u79fb\u9664\u5b9e\u4f8b",
  },
  users: {
    menuTitle: "\u7528\u6237\u7ba1\u7406",
    menuSmall: "\u6d41\u91cf / \u914d\u989d / \u5230\u671f\u65f6\u95f4",
  },
  subscription: {
    menuTitle: "\u8ba2\u9605\u670d\u52a1",
    menuSmall: "V2Ray / Clash / Surge",
  },
  routing: {
    menuTitle: "\u5206\u6d41\u7ba1\u7406",
    menuSmall: "WARP / Chain / Balancer",
  },
};

const state = {
  meta: null,
  protocols: [],
  cores: [],
  users: [],
  subscriptions: [],
  routing: [],
  logs: [],
  activeTab: "form",
  installStatus: {
    running: false,
    state: "idle",
    protocol: "",
    progress: 0,
    message: "",
    error: "",
    events: [],
    can_cancel: false,
  },
};

let installStatusPollTimer = null;

const menuItems = document.querySelectorAll(".menu-item");
const contentSections = document.querySelectorAll(".section");
const pageTitle = document.getElementById("page-title");
const sectionHeading = document.getElementById("section-heading");
const commandPreview = document.getElementById("command-preview");
const toastMessage = document.getElementById("toast-message");
const modeIndicatorBtn = document.getElementById("mode-indicator-btn");
const segmentControl = document.querySelector(".segment-control");

const sectionActionMap = {
  install: ["install"],
  core: ["core-update"],
  uninstall: ["uninstall"],
  users: ["user-create", "user-delete"],
  subscription: ["subscription-update", "subscription-reset"],
  routing: ["routing-add", "routing-delete"],
};

function isRealityProtocol(protocol) {
  return protocol === "vless" || protocol === "vless-xhttp";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPort(protocol) {
  const ranges = {
    vless: [20000, 40000],
    "vless-xhttp": [20000, 40000],
    trojan: [20000, 40000],
    "vmess-ws": [20000, 40000],
    hy2: [20000, 40000],
    tuic: [20000, 40000],
  };
  const [min, max] = ranges[protocol] || [20000, 40000];
  return String(randomInt(min, max));
}

function randomShortId() {
  const alphabet = "abcdef0123456789";
  const length = randomInt(6, 12);
  return Array.from({ length }, () => alphabet[randomInt(0, alphabet.length - 1)]).join("");
}

function randomServerName() {
  return realityServerNames[randomInt(0, realityServerNames.length - 1)];
}

function textOfStatus(status) {
  return statusText[status] || status || statusText.unknown;
}

function textOfCoreChannel(channel) {
  if (channel === "stable") return "\u7a33\u5b9a\u7248";
  if (channel === "manual") return "\u624b\u52a8";
  if (channel === "live") return "\u5b9e\u65f6";
  return channel;
}

function labelForAction(action) {
  const mapping = {
    install: "\u5b89\u88c5\u534f\u8bae",
    uninstall: "\u5378\u8f7d\u534f\u8bae",
    "core-update": "\u66f4\u65b0\u6838\u5fc3",
    "user-create": "\u65b0\u589e\u7528\u6237",
    "user-delete": "\u5220\u9664\u7528\u6237",
    "subscription-update": "\u4fdd\u5b58\u8ba2\u9605\u8bbe\u7f6e",
    "subscription-reset": "\u91cd\u7f6e\u8ba2\u9605 UUID",
    "routing-add": "\u65b0\u589e\u5206\u6d41\u89c4\u5219",
    "routing-delete": "\u5220\u9664\u5206\u6d41\u89c4\u5219",
    seed: "\u521d\u59cb\u5316\u9762\u677f\u6570\u636e",
  };
  return mapping[action] || action;
}

function logsForSection(sectionId) {
  const actions = sectionActionMap[sectionId] || [];
  return state.logs.filter((item) => actions.includes(item.action));
}

function renderSectionExecutionLogs() {
  document.querySelectorAll(".section").forEach((section) => {
    const container = section.querySelector(".section-log-list");
    if (!container) return;

    const logs = logsForSection(section.id);
    container.innerHTML = logs.length
      ? logs
          .map(
            (item) => `
              <article class="section-log-item">
                <div class="section-log-head">
                  <strong>${escapeHtml(labelForAction(item.action))}</strong>
                  <span>${escapeHtml(item.created_at?.replace("T", " ").slice(0, 16) || "--")}</span>
                </div>
                <p>${escapeHtml(item.detail)}</p>
              </article>
            `
          )
          .join("")
      : `<p class="section-log-empty">\u5f53\u524d\u5206\u7c7b\u6682\u65e0\u6267\u884c\u8bb0\u5f55</p>`;
  });
}

function ensureInstallStatusCard() {
  if (document.getElementById("install-status-card")) return;

  const sidePanel = document.querySelector(".panel.panel-side");
  const panelHead = sidePanel?.querySelector(".panel-head");
  if (!sidePanel || !panelHead) return;

  const card = document.createElement("section");
  card.className = "install-status-card";
  card.id = "install-status-card";
  card.innerHTML = `
    <div class="install-status-head">
      <div>
        <p class="panel-kicker">\u5b89\u88c5\u4efb\u52a1</p>
        <h4 id="install-status-title">\u5f53\u524d\u6ca1\u6709\u5b89\u88c5\u4efb\u52a1</h4>
      </div>
      <span class="install-status-state state-idle" id="install-status-badge">\u7a7a\u95f2</span>
    </div>
    <div class="install-progress-row">
      <strong id="install-status-progress-text">0%</strong>
      <span id="install-status-message">\u7b49\u5f85\u5f00\u59cb\u5b89\u88c5</span>
    </div>
    <div class="progress-track">
      <span id="install-status-progress-bar"></span>
    </div>
    <p class="install-status-error" id="install-status-error" hidden></p>
    <div class="install-status-events" id="install-status-events">
      <p class="install-status-empty">\u672a\u68c0\u6d4b\u5230\u5b89\u88c5\u8fdb\u5ea6\u8bb0\u5f55</p>
    </div>
  `;

  sidePanel.insertBefore(card, panelHead.nextSibling);
}

function setActiveTab(tab) {
  state.activeTab = tab;

  segmentControl.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  });

  const visibleSection = document.querySelector(".section.is-visible");
  if (!visibleSection) return;

  visibleSection.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
}

function setupSectionTabs() {
  document.querySelectorAll(".section").forEach((section) => {
    if (section.querySelector(".tab-panel")) return;

    const children = Array.from(section.children);
    const formPanel = document.createElement("div");
    formPanel.className = "tab-panel";
    formPanel.dataset.tabPanel = "form";
    children.forEach((child) => formPanel.appendChild(child));

    const logPanel = document.createElement("div");
    logPanel.className = "tab-panel";
    logPanel.dataset.tabPanel = "logs";
    logPanel.hidden = true;
    logPanel.innerHTML = `
      <div class="mini-card">
        <h4>\u6267\u884c\u8bb0\u5f55</h4>
        <p>\u8fd9\u91cc\u4f1a\u663e\u793a\u5f53\u524d\u529f\u80fd\u5206\u7c7b\u6700\u8fd1\u7684\u64cd\u4f5c\u65e5\u5fd7\u3002</p>
        <div class="section-log-list"></div>
      </div>
    `;

    section.appendChild(formPanel);
    section.appendChild(logPanel);
  });

  segmentControl.innerHTML = `
    <button class="segment is-active" data-tab="form">\u8868\u5355</button>
    <button class="segment" data-tab="logs">\u6267\u884c\u8bb0\u5f55</button>
  `;

  segmentControl.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
}

function localizeStaticText() {
  document.title = "VLESS \u670d\u52a1\u9762\u677f";
  document.querySelector(".brand-kicker").textContent = "\u514d\u767b\u5f55\u63a7\u5236\u53f0";
  document.querySelector(".brand h1").textContent = "VLESS \u670d\u52a1\u9762\u677f";
  document.querySelector(".sidebar-note").textContent =
    "\u672c\u5730\u5efa\u8bae\u5148\u7528 Mock \u6a21\u5f0f\u8054\u8c03\u754c\u9762\u548c\u6d41\u7a0b\uff0c\u786e\u8ba4\u4ea4\u4e92\u6b63\u5e38\u540e\u518d\u5207\u5230 Linux VPS \u7684 Live \u6a21\u5f0f\u3002";
  document.querySelector(".sidebar-footer strong").textContent = "\u672c\u5730\u8054\u8c03 / \u670d\u52a1\u5668\u90e8\u7f72";
  document.querySelector(".status-card p").textContent = "\u5f53\u524d\u6a21\u5f0f";
  document.querySelector(".eyebrow").textContent = "\u591a\u534f\u8bae\u53ef\u89c6\u5316\u63a7\u5236\u9762\u677f";
  document.getElementById("refresh-all-btn").textContent = "\u540c\u6b65\u9762\u677f\u6570\u636e";
  document.querySelector(".hero-tag").textContent = "Windows \u672c\u5730\u6d4b\u8bd5 + Linux \u6b63\u5f0f\u90e8\u7f72";
  document.querySelector(".hero h3").textContent =
    "\u628a\u811a\u672c\u80fd\u529b\u63a5\u6210\u53ef\u89c6\u5316\u9762\u677f\uff0c\u5148\u672c\u5730\u8dd1\u901a\uff0c\u518d\u56de\u5230\u670d\u52a1\u5668\u4e0a\u7ebf";
  document.querySelector(".hero p:not(.hero-tag)").textContent =
    "\u8fd9\u4e2a\u9762\u677f\u56f4\u7ed5\u5b89\u88c5\u3001\u6838\u5fc3\u66f4\u65b0\u3001\u5378\u8f7d\u3001\u7528\u6237\u3001\u8ba2\u9605\u548c\u5206\u6d41\u516d\u7c7b\u64cd\u4f5c\u7ec4\u7ec7\u3002Windows \u672c\u5730\u53ef\u7528 Mock \u6570\u636e\u76f4\u63a5\u6d4b\u8bd5 GUI\uff0cLinux \u670d\u52a1\u5668\u518d\u5207\u5230 Live \u6a21\u5f0f\u8fde\u63a5\u5b9e\u9645\u811a\u672c\u3002";

  const heroLabels = document.querySelectorAll(".hero-stats span");
  heroLabels[0].textContent = "\u5df2\u5b89\u88c5\u534f\u8bae";
  heroLabels[1].textContent = "\u7528\u6237\u6570";
  heroLabels[2].textContent = "\u5206\u6d41\u89c4\u5219";
  document.getElementById("stat-installed-sub").textContent = "\u7b49\u5f85\u52a0\u8f7d";
  document.getElementById("stat-users-sub").textContent = "\u7b49\u5f85\u52a0\u8f7d";
  document.getElementById("stat-routing-sub").textContent = "\u7b49\u5f85\u52a0\u8f7d";

  document.querySelector(".panel.panel-wide .panel-kicker").textContent = "\u64cd\u4f5c\u533a";
  menuItems.forEach((item) => {
    const key = item.dataset.section;
    item.querySelector("strong").textContent = sectionText[key].menuTitle;
    item.querySelector("small").textContent = sectionText[key].menuSmall;
  });

  const installLabels = document.querySelectorAll("#install label");
  installLabels[0].childNodes[0].textContent = "\u534f\u8bae\u7c7b\u578b\n                    ";
  installLabels[1].childNodes[0].textContent = "\u76d1\u542c\u7aef\u53e3\n                    ";
  installLabels[2].childNodes[0].textContent = "\u57df\u540d\uff08\u53ef\u9009\uff09\n                    ";
  installLabels[3].childNodes[0].textContent = "\u8bc1\u4e66\u6a21\u5f0f\n                    ";
  installLabels[4].childNodes[0].textContent = "Reality \u77ed ID\n                    ";
  installLabels[5].childNodes[0].textContent = "Reality serverName\n                    ";
  installLabels[6].childNodes[0].textContent = "\u5b89\u88c5\u5907\u6ce8\n                    ";
  installLabels[7].childNodes[0].textContent = "\u6838\u5fc3\n                    ";
  installLabels[8].childNodes[0].textContent = "\u4f20\u8f93\u65b9\u5f0f\n                    ";
  document.getElementById("install-port-random-btn").textContent = "\u968f\u673a";
  document.getElementById("install-short-id-random-btn").textContent = "\u968f\u673a";
  document.getElementById("install-domain-hint").textContent =
    "\u4e0d\u586b\u4e5f\u53ef\u4ee5\u5b89\u88c5\uff1b\u5378\u8f7d\u65f6\u4f1a\u6309\u534f\u8bae\u548c\u7aef\u53e3\u5904\u7406\uff0c\u4e0d\u4f9d\u8d56\u57df\u540d\u3002";
  document.getElementById("install-domain").placeholder = "\u4ec5\u5728\u9700\u8981\u8bc1\u4e66\u6216 CDN \u65f6\u586b\u5199";
  document.querySelector('#install-cert-mode option[value="acme"]').textContent = "ACME \u81ea\u52a8\u7533\u8bf7";
  document.querySelector('#install-cert-mode option[value="existing"]').textContent = "\u590d\u7528\u5df2\u6709\u8bc1\u4e66";
  document.querySelector('#install-cert-mode option[value="self-signed"]').textContent = "\u81ea\u7b7e\u8bc1\u4e66";
  document.getElementById("install-submit-btn").textContent = "\u63d0\u4ea4\u5b89\u88c5";

  const coreHeaders = document.querySelectorAll("#core th");
  coreHeaders[0].textContent = "\u6838\u5fc3";
  coreHeaders[1].textContent = "\u5f53\u524d\u7248\u672c";
  coreHeaders[2].textContent = "\u76ee\u6807\u7248\u672c";
  coreHeaders[3].textContent = "\u901a\u9053";
  coreHeaders[4].textContent = "\u64cd\u4f5c";

  const uninstallHeaders = document.querySelectorAll("#uninstall th");
  uninstallHeaders[0].textContent = "\u534f\u8bae";
  uninstallHeaders[1].textContent = "\u6838\u5fc3";
  uninstallHeaders[2].textContent = "\u7aef\u53e3";
  uninstallHeaders[3].textContent = "\u670d\u52a1";
  uninstallHeaders[4].textContent = "\u72b6\u6001";
  uninstallHeaders[5].textContent = "\u64cd\u4f5c";
  document.querySelector("#uninstall .warning-box strong").textContent = "\u6ce8\u610f";
  document.querySelector("#uninstall .warning-box p").innerHTML =
    "\u672c\u5730 Mock \u6a21\u5f0f\u4f1a\u4fee\u6539 <code>runtime/panel.db</code>\uff0cLinux Live \u6a21\u5f0f\u5219\u4f1a\u5b9e\u9645\u6539\u52a8\u670d\u52a1\u5668\u811a\u672c\u6570\u636e\u3002";

  const userCards = document.querySelectorAll("#users .metric-card span");
  userCards[0].textContent = "\u6d3b\u8dc3\u7528\u6237";
  userCards[1].textContent = "\u5f02\u5e38\u72b6\u6001";
  userCards[2].textContent = "\u5e26\u5230\u671f\u65f6\u95f4";
  const userCardSmall = document.querySelectorAll("#users .metric-card small");
  userCardSmall[0].textContent = "\u6765\u81ea\u5f53\u524d\u9762\u677f\u6570\u636e";
  userCardSmall[1].textContent = "\u544a\u8b66 / \u505c\u7528";
  userCardSmall[2].textContent = "\u53ef\u7ee7\u7eed\u6309\u9700\u6269\u5c55\u63d0\u9192\u903b\u8f91";
  const userLabels = document.querySelectorAll("#users form label");
  userLabels[0].childNodes[0].textContent = "\u7528\u6237\u540d\n                  ";
  userLabels[1].childNodes[0].textContent = "\u534f\u8bae\n                  ";
  userLabels[2].childNodes[0].textContent = "\u7aef\u53e3\n                  ";
  userLabels[3].childNodes[0].textContent = "\u914d\u989d (GB)\n                  ";
  userLabels[4].childNodes[0].textContent = "\u5230\u671f\u65e5\u671f\n                  ";
  userLabels[5].childNodes[0].textContent = "\u72b6\u6001\n                  ";
  document.querySelector('#user-status option[value="enabled"]').textContent = "\u5df2\u542f\u7528";
  document.querySelector('#user-status option[value="warning"]').textContent = "\u544a\u8b66";
  document.querySelector('#user-status option[value="disabled"]').textContent = "\u5df2\u505c\u7528";
  document.getElementById("user-create-btn").textContent = "\u65b0\u589e\u7528\u6237";
  const userHeaders = document.querySelectorAll("#users th");
  userHeaders[0].textContent = "\u7528\u6237\u540d";
  userHeaders[1].textContent = "\u534f\u8bae";
  userHeaders[2].textContent = "\u7aef\u53e3";
  userHeaders[3].textContent = "\u5df2\u7528\u6d41\u91cf";
  userHeaders[4].textContent = "\u914d\u989d";
  userHeaders[5].textContent = "\u5230\u671f\u65f6\u95f4";
  userHeaders[6].textContent = "\u72b6\u6001";
  userHeaders[7].textContent = "\u64cd\u4f5c";

  document.querySelector("#subscription .accent-gold h4").textContent = "\u8ba2\u9605\u5165\u53e3";
  document.querySelector("#subscription .accent-gold p").textContent =
    "\u805a\u5408\u751f\u6210 V2Ray\u3001Clash\u3001Surge \u4e09\u79cd\u8ba2\u9605\u5730\u5740\uff0c\u4fbf\u4e8e\u5ba2\u6237\u7aef\u5feb\u901f\u63a5\u5165\u3002";
  document.querySelector("#subscription .mini-card:not(.accent-gold) h4").textContent = "\u5f53\u524d UUID";
  const subLabels = document.querySelectorAll("#subscription form label");
  subLabels[0].childNodes[0].textContent = "\u8ba2\u9605\u540d\u79f0\n                    ";
  subLabels[1].childNodes[0].textContent = "\u9ed8\u8ba4\u683c\u5f0f\n                    ";
  subLabels[2].childNodes[0].textContent = "\u8ba2\u9605\u94fe\u63a5\n                    ";
  document.getElementById("subscription-save-btn").textContent = "\u4fdd\u5b58\u8ba2\u9605\u8bbe\u7f6e";
  document.getElementById("subscription-reset-btn").textContent = "\u91cd\u7f6e\u8ba2\u9605 UUID";

  const routingCards = document.querySelectorAll("#routing .metric-card span");
  routingCards[0].textContent = "\u5206\u6d41\u89c4\u5219";
  routingCards[1].textContent = "\u94fe\u5f0f\u51fa\u53e3";
  routingCards[2].textContent = "\u8d1f\u8f7d\u5747\u8861";
  const routingCardSmall = document.querySelectorAll("#routing .metric-card small");
  routingCardSmall[0].textContent = "\u5168\u5c40 + \u7528\u6237\u7ef4\u5ea6";
  routingCardSmall[1].textContent = "\u540e\u7eed\u53ef\u7ee7\u7eed\u63a5\u811a\u672c\u5bfc\u5165";
  routingCardSmall[2].textContent = "\u5f53\u524d\u4e3a\u6f14\u793a\u5360\u4f4d\u6570\u636e";
  const routingLabels = document.querySelectorAll("#routing form label");
  routingLabels[0].childNodes[0].textContent = "\u89c4\u5219\u7c7b\u578b\n                  ";
  routingLabels[1].childNodes[0].textContent = "\u76ee\u6807\n                  ";
  routingLabels[2].childNodes[0].textContent = "\u51fa\u53e3\n                  ";
  routingLabels[3].childNodes[0].textContent = "IP \u7b56\u7565\n                  ";
  routingLabels[4].childNodes[0].textContent = "\u4f18\u5148\u7ea7\n                  ";
  document.getElementById("routing-add-btn").textContent = "\u65b0\u589e\u89c4\u5219";
  const routingHeaders = document.querySelectorAll("#routing th");
  routingHeaders[0].textContent = "\u89c4\u5219\u7c7b\u578b";
  routingHeaders[1].textContent = "\u76ee\u6807";
  routingHeaders[2].textContent = "\u51fa\u53e3";
  routingHeaders[3].textContent = "IP \u7b56\u7565";
  routingHeaders[4].textContent = "\u4f18\u5148\u7ea7";
  routingHeaders[5].textContent = "\u64cd\u4f5c";

  document.querySelector(".panel.panel-side .panel-kicker").textContent = "\u5feb\u901f\u6982\u89c8";
  document.querySelector(".panel.panel-side h3").textContent = "\u8fd0\u884c\u6982\u89c8";
  const commandKicker = document.querySelector(".command-box .panel-kicker");
  commandKicker.textContent = "\u540e\u7aef\u63a5\u53e3";
  toastMessage.textContent = "\u9762\u677f\u5df2\u5c31\u7eea\uff0c\u7b49\u5f85\u52a0\u8f7d\u6570\u636e\u3002";
  document.querySelector(".command-box p:last-child").textContent =
    "\u5f53\u524d\u754c\u9762\u6309\u94ae\u90fd\u901a\u8fc7\u672c\u5730 API \u89e6\u53d1\uff0cWindows \u8054\u8c03\u7528 Mock \u6a21\u5f0f\uff0cLinux \u90e8\u7f72\u5207\u5230 Live \u6a21\u5f0f\u3002";
}

function installStateLabel(status) {
  const mapping = {
    idle: "\u7a7a\u95f2",
    running: "\u5b89\u88c5\u4e2d",
    success: "\u5df2\u5b8c\u6210",
    cancelled: "\u5df2\u53d6\u6d88",
    error: "\u5b89\u88c5\u5931\u8d25",
  };
  return mapping[status] || "\u672a\u77e5";
}

function installStateClass(status) {
  if (status === "running") return "state-running";
  if (status === "success") return "state-success";
  if (status === "cancelled") return "state-cancelled";
  if (status === "error") return "state-error";
  return "state-idle";
}

function syncInstallFieldState() {
  const busy = Boolean(state.installStatus?.running);
  const protocol = document.getElementById("install-protocol").value;
  const domain = document.getElementById("install-domain").value.trim();
  const certMode = document.getElementById("install-cert-mode");
  const shortIdInput = document.getElementById("install-short-id");
  const serverNameInput = document.getElementById("install-server-name");
  const shortIdButton = document.getElementById("install-short-id-random-btn");
  const portButton = document.getElementById("install-port-random-btn");

  document.querySelectorAll("#install input, #install textarea, #install select").forEach((element) => {
    element.disabled = busy;
  });

  portButton.disabled = busy;
  shortIdButton.disabled = busy;

  if (!busy) {
    const reality = isRealityProtocol(protocol);
    shortIdInput.disabled = !reality;
    serverNameInput.disabled = !reality;
    shortIdButton.disabled = !reality;

    certMode.disabled = !domain;
  }
}

function updateInstallButton() {
  const button = document.getElementById("install-submit-btn");
  const status = state.installStatus || {};
  button.classList.toggle("danger-btn", Boolean(status.running));
  button.classList.toggle("primary-btn", !status.running);
  button.textContent = status.running ? "\u53d6\u6d88\u5b89\u88c5" : "\u63d0\u4ea4\u5b89\u88c5";
}

function renderInstallStatus(status) {
  ensureInstallStatusCard();

  const title = document.getElementById("install-status-title");
  const badge = document.getElementById("install-status-badge");
  const progressText = document.getElementById("install-status-progress-text");
  const message = document.getElementById("install-status-message");
  const progressBar = document.getElementById("install-status-progress-bar");
  const error = document.getElementById("install-status-error");
  const events = document.getElementById("install-status-events");

  if (!title || !badge || !progressText || !message || !progressBar || !error || !events) return;

  const protocolName = status.protocol ? status.protocol.toUpperCase() : "\u5f53\u524d\u6ca1\u6709\u5b89\u88c5\u4efb\u52a1";
  title.textContent = status.protocol ? `${protocolName} \u5b89\u88c5\u8fdb\u5ea6` : protocolName;
  badge.className = `install-status-state ${installStateClass(status.state)}`;
  badge.textContent = installStateLabel(status.state);
  progressText.textContent = `${Number(status.progress || 0)}%`;
  message.textContent = status.message || "\u7b49\u5f85\u5f00\u59cb\u5b89\u88c5";
  progressBar.style.width = `${Number(status.progress || 0)}%`;

  if (status.error) {
    error.hidden = false;
    error.textContent = status.error;
  } else {
    error.hidden = true;
    error.textContent = "";
  }

  const recentEvents = Array.isArray(status.events) ? status.events.slice().reverse().slice(0, 5) : [];
  events.innerHTML = recentEvents.length
    ? recentEvents
        .map(
          (item) => `
            <article class="install-status-event">
              <span class="install-event-time">${escapeHtml(item.time?.replace("T", " ").slice(11, 19) || "--:--:--")}</span>
              <p class="install-event-text ${item.level === "error" ? "is-error" : item.level === "warning" ? "is-warning" : ""}">${escapeHtml(item.text || "")}</p>
            </article>
          `
        )
        .join("")
    : `<p class="install-status-empty">\u672a\u68c0\u6d4b\u5230\u5b89\u88c5\u8fdb\u5ea6\u8bb0\u5f55</p>`;

  updateInstallButton();
  syncInstallFieldState();
}

async function api(path, options = {}) {
  const { returnFullResult = false, ...fetchOptions } = options;
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...fetchOptions,
  });

  const raw = await response.text();
  let result;
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`\u63a5\u53e3\u8fd4\u56de\u7684\u4e0d\u662f JSON\uff1a${response.status}`);
  }

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || `\u8bf7\u6c42\u5931\u8d25\uff1a${response.status}`);
  }

  return returnFullResult ? result : (result.data ?? result);
}

function notify(message) {
  toastMessage.textContent = message;
}

function badgeClass(status) {
  if (status === "running" || status === "enabled") return "green";
  if (status === "warning" || status === "manual") return "amber";
  return "red";
}

function setActiveSection(key) {
  const current = sections[key];
  if (!current) return;

  menuItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.section === key);
  });

  contentSections.forEach((section) => {
    section.classList.toggle("is-visible", section.id === key);
  });

  pageTitle.textContent = current.title;
  sectionHeading.textContent = current.heading;
  commandPreview.textContent = current.command;
  setActiveTab(state.activeTab);
}

function updateModeIndicator() {
  if (!state.meta) {
    modeIndicatorBtn.textContent = "\u6a21\u5f0f\u672a\u77e5";
    return;
  }
  const modeLabel = state.meta.mode === "live" ? "\u6b63\u5f0f\u6a21\u5f0f" : "\u672c\u5730\u6d4b\u8bd5";
  const platform = state.meta.platform === "nt" ? "Windows" : state.meta.platform;
  modeIndicatorBtn.textContent = `${modeLabel} | ${platform}`;
}

function renderDashboard(data) {
  document.getElementById("stat-installed").textContent = `${data.stats.installed} \u4e2a\u534f\u8bae`;
  document.getElementById("stat-installed-sub").textContent = "\u5b89\u88c5\u548c\u5378\u8f7d\u540e\u4f1a\u81ea\u52a8\u5237\u65b0";
  document.getElementById("stat-users").textContent = `${data.stats.users}`;
  document.getElementById("stat-users-sub").textContent = `${data.stats.expiring} \u4e2a\u544a\u8b66\u6216\u505c\u7528`;
  document.getElementById("stat-routing").textContent = `${data.stats.routes} \u6761\u89c4\u5219`;
  document.getElementById("stat-routing-sub").textContent = "\u5206\u6d41\u6570\u636e\u5df2\u63a5\u901a";

  const timeline = document.getElementById("timeline-list");
  timeline.innerHTML = data.logs.length
    ? data.logs
        .map(
          (item) => `
            <article>
              <span class="timeline-time">${escapeHtml(item.created_at?.slice(11, 16) || "--:--")}</span>
              <div>
                <strong>${escapeHtml(item.action)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </div>
            </article>
          `
        )
        .join("")
    : "<p>\u6682\u65e0\u65e5\u5fd7</p>";
}

function renderProtocols() {
  const body = document.getElementById("protocol-table-body");
  body.innerHTML = state.protocols
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.core)}</td>
          <td>${escapeHtml(item.port)}</td>
          <td>${escapeHtml(item.service)}</td>
          <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(textOfStatus(item.status))}</span></td>
          <td><button class="danger-btn" data-uninstall-id="${escapeHtml(item.id)}">\u5378\u8f7d</button></td>
        </tr>
      `
    )
    .join("");
}

function renderCores() {
  const body = document.getElementById("core-table-body");
  body.innerHTML = state.cores
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.current_version)}</td>
          <td>${escapeHtml(item.latest_version)}</td>
          <td>${escapeHtml(textOfCoreChannel(item.channel))}</td>
          <td><button class="link-btn" data-core-name="${escapeHtml(item.name)}" data-core-target="${escapeHtml(item.latest_version)}">\u66f4\u65b0</button></td>
        </tr>
      `
    )
    .join("");
}

function renderUsers() {
  document.getElementById("users-total").textContent = String(state.users.length);
  document.getElementById("users-warning").textContent = String(state.users.filter((item) => item.status !== "enabled").length);
  document.getElementById("users-expiring").textContent = String(state.users.filter((item) => item.expire_at).length);

  const body = document.getElementById("user-table-body");
  body.innerHTML = state.users
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.username)}</td>
          <td>${escapeHtml(item.protocol)}</td>
          <td>${escapeHtml(item.port)}</td>
          <td>${Number(item.used_gb).toFixed(1)} GB</td>
          <td>${Number(item.quota_gb).toFixed(1)} GB</td>
          <td>${escapeHtml(item.expire_at)}</td>
          <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(textOfStatus(item.status))}</span></td>
          <td><button class="danger-btn" data-user-delete-id="${escapeHtml(item.id)}">\u5220\u9664</button></td>
        </tr>
      `
    )
    .join("");
}

function renderSubscriptions() {
  const current = state.subscriptions[0];
  if (!current) return;

  document.getElementById("subscription-name").value = current.name;
  document.getElementById("subscription-format").value = current.default_format;
  document.getElementById("subscription-uuid").textContent = current.sub_uuid;
  document.getElementById("subscription-links").value = [
    current.links.v2ray,
    current.links.clash,
    current.links.surge,
  ].join("\n");
}

function renderRouting() {
  document.getElementById("routing-total").textContent = String(state.routing.length);
  const body = document.getElementById("routing-table-body");
  body.innerHTML = state.routing
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.rule_type)}</td>
          <td>${escapeHtml(item.target)}</td>
          <td>${escapeHtml(item.outbound)}</td>
          <td>${escapeHtml(item.ip_strategy)}</td>
          <td>${escapeHtml(item.priority)}</td>
          <td><button class="danger-btn" data-routing-delete-id="${escapeHtml(item.id)}">\u5220\u9664</button></td>
        </tr>
      `
    )
    .join("");
}

async function refreshAll() {
  const [meta, dashboard, protocols, cores, users, subscriptions, routing] = await Promise.all([
    api("/api/meta"),
    api("/api/dashboard"),
    api("/api/protocols"),
    api("/api/cores"),
    api("/api/users"),
    api("/api/subscriptions"),
    api("/api/routing"),
  ]);

  state.meta = meta;
  state.protocols = protocols;
  state.cores = cores;
  state.users = users;
  state.subscriptions = subscriptions;
  state.routing = routing;
  state.logs = dashboard.logs || [];

  updateModeIndicator();
  renderDashboard(dashboard);
  renderProtocols();
  renderCores();
  renderUsers();
  renderSubscriptions();
  renderRouting();
  renderSectionExecutionLogs();
  notify(`\u9762\u677f\u6570\u636e\u5df2\u540c\u6b65\uff0c\u5f53\u524d\u6a21\u5f0f\uff1a${meta.mode}`);
}

function syncInstallDefaults() {
  const protocol = document.getElementById("install-protocol").value;
  const preset = protocolDefaults[protocol];
  if (!preset) return;

  document.getElementById("install-port").value = randomPort(protocol);
  document.getElementById("install-core").value = preset.core;
  document.getElementById("install-transport").value = preset.transport;

  const shortIdInput = document.getElementById("install-short-id");
  const serverNameInput = document.getElementById("install-server-name");

  if (isRealityProtocol(protocol)) {
    shortIdInput.value = randomShortId();
    serverNameInput.value = randomServerName();
  } else {
    shortIdInput.value = "";
    serverNameInput.value = "";
  }

  syncInstallDomainState();
  syncInstallFieldState();
}

function syncInstallDomainState() {
  const domain = document.getElementById("install-domain").value.trim();
  const protocol = document.getElementById("install-protocol").value;
  const certMode = document.getElementById("install-cert-mode");
  const domainHint = document.getElementById("install-domain-hint");

  if (!domain) {
    certMode.value = "self-signed";
    domainHint.textContent =
      "\u4e0d\u586b\u57df\u540d\u65f6\uff0c\u8bc1\u4e66\u6a21\u5f0f\u4f1a\u81ea\u52a8\u4f7f\u7528\u81ea\u7b7e\u8bc1\u4e66\uff1b\u5378\u8f7d\u65f6\u4ecd\u7136\u6309\u534f\u8bae\u548c\u7aef\u53e3\u5904\u7406\u3002";
  } else {
    if (isRealityProtocol(protocol)) {
      certMode.value = certMode.value === "self-signed" ? "acme" : certMode.value;
    }
    domainHint.textContent =
      "\u586b\u5199\u57df\u540d\u540e\uff0c\u53ef\u4ee5\u4f7f\u7528 ACME \u6216\u590d\u7528\u5df2\u6709\u8bc1\u4e66\uff1b\u5378\u8f7d\u65f6\u4e0d\u4f9d\u8d56\u57df\u540d\u3002";
  }

  syncInstallFieldState();
}

function requireValue(id, label) {
  const value = document.getElementById(id).value.trim();
  if (!value) {
    throw new Error(`${label}\u4e0d\u80fd\u4e3a\u7a7a`);
  }
  return value;
}

function stopInstallPolling() {
  if (installStatusPollTimer) {
    window.clearInterval(installStatusPollTimer);
    installStatusPollTimer = null;
  }
}

function startInstallPolling() {
  if (installStatusPollTimer) return;
  installStatusPollTimer = window.setInterval(async () => {
    try {
      await fetchInstallStatus();
    } catch (error) {
      stopInstallPolling();
      notify(`\u5b89\u88c5\u72b6\u6001\u8f6e\u8be2\u5931\u8d25\uff1a${error.message}`);
    }
  }, 1000);
}

async function fetchInstallStatus() {
  const previous = state.installStatus || {};
  const status = await api("/api/install/status");
  state.installStatus = status;
  renderInstallStatus(status);

  if (status.running) {
    startInstallPolling();
  } else {
    stopInstallPolling();
    if (previous.running && (status.state === "success" || status.state === "cancelled" || status.state === "error")) {
      await refreshAll();
      notify(status.error || status.message || "\u5b89\u88c5\u4efb\u52a1\u5df2\u7ed3\u675f");
    }
  }

  return status;
}

async function cancelInstall() {
  const result = await api("/api/install/cancel", {
    method: "POST",
    body: JSON.stringify({}),
    returnFullResult: true,
  });
  notify(result.message || "\u5df2\u53d1\u9001\u53d6\u6d88\u8bf7\u6c42");
  await fetchInstallStatus();
}

async function submitInstall() {
  const protocol = requireValue("install-protocol", "\u534f\u8bae");
  const shortId = document.getElementById("install-short-id").value.trim();
  const serverName = document.getElementById("install-server-name").value.trim();
  const notes = document.getElementById("install-notes").value.trim();

  const payload = {
    protocol,
    port: requireValue("install-port", "\u7aef\u53e3"),
    domain: document.getElementById("install-domain").value.trim(),
    cert_mode: requireValue("install-cert-mode", "\u8bc1\u4e66\u6a21\u5f0f"),
    short_id: shortId,
    server_name: serverName,
    notes: [
      notes,
      shortId ? `Short ID: ${shortId}` : "",
      serverName ? `Reality serverName: ${serverName}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    core: requireValue("install-core", "\u6838\u5fc3"),
    transport: requireValue("install-transport", "\u4f20\u8f93\u65b9\u5f0f"),
  };
  const result = await api("/api/install", {
    method: "POST",
    body: JSON.stringify(payload),
    returnFullResult: true,
  });
  notify(result.message || "\u5b89\u88c5\u4efb\u52a1\u5df2\u542f\u52a8");
  await fetchInstallStatus();
}

async function createUser() {
  const payload = {
    username: requireValue("user-name", "\u7528\u6237\u540d"),
    protocol: requireValue("user-protocol", "\u534f\u8bae"),
    port: requireValue("user-port", "\u7aef\u53e3"),
    quota_gb: requireValue("user-quota", "\u914d\u989d"),
    expire_at: requireValue("user-expire", "\u5230\u671f\u65e5\u671f"),
    status: requireValue("user-status", "\u72b6\u6001"),
  };
  const result = await api("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notify(result.message);
  await refreshAll();
}

async function addRouting() {
  const payload = {
    rule_type: requireValue("routing-type", "\u89c4\u5219\u7c7b\u578b"),
    target: requireValue("routing-target", "\u76ee\u6807"),
    outbound: requireValue("routing-outbound", "\u51fa\u53e3"),
    ip_strategy: requireValue("routing-ip-strategy", "IP \u7b56\u7565"),
    priority: requireValue("routing-priority", "\u4f18\u5148\u7ea7"),
  };
  const result = await api("/api/routing", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notify(result.message);
  await refreshAll();
}

async function resetSubscription() {
  const current = state.subscriptions[0];
  if (!current) {
    throw new Error("\u6ca1\u6709\u53ef\u7528\u7684\u8ba2\u9605\u6570\u636e");
  }
  const result = await api("/api/subscriptions/reset", {
    method: "POST",
    body: JSON.stringify({ id: current.id }),
  });
  notify(result.message);
  await refreshAll();
}

async function saveSubscription() {
  const current = state.subscriptions[0];
  if (!current) {
    throw new Error("\u6ca1\u6709\u53ef\u7528\u7684\u8ba2\u9605\u6570\u636e");
  }
  const payload = {
    id: current.id,
    name: requireValue("subscription-name", "\u8ba2\u9605\u540d\u79f0"),
    default_format: requireValue("subscription-format", "\u9ed8\u8ba4\u683c\u5f0f"),
  };
  const result = await api("/api/subscriptions/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notify(result.message);
  await refreshAll();
}

document.addEventListener("click", async (event) => {
  const uninstallId = event.target.dataset.uninstallId;
  const coreName = event.target.dataset.coreName;
  const coreTarget = event.target.dataset.coreTarget;
  const userDeleteId = event.target.dataset.userDeleteId;
  const routingDeleteId = event.target.dataset.routingDeleteId;

  try {
    if (uninstallId) {
      const result = await api("/api/uninstall", {
        method: "POST",
        body: JSON.stringify({ id: uninstallId }),
      });
      notify(result.message);
      await refreshAll();
    } else if (coreName) {
      const result = await api("/api/core/update", {
        method: "POST",
        body: JSON.stringify({ name: coreName, target_version: coreTarget }),
      });
      notify(result.message);
      await refreshAll();
    } else if (userDeleteId) {
      const result = await api("/api/users", {
        method: "DELETE",
        body: JSON.stringify({ id: userDeleteId }),
      });
      notify(result.message);
      await refreshAll();
    } else if (routingDeleteId) {
      const result = await api("/api/routing", {
        method: "DELETE",
        body: JSON.stringify({ id: routingDeleteId }),
      });
      notify(result.message);
      await refreshAll();
    }
  } catch (error) {
    notify(error.message);
  }
});

menuItems.forEach((item) => {
  item.addEventListener("click", () => setActiveSection(item.dataset.section));
});

document.getElementById("install-protocol").addEventListener("change", syncInstallDefaults);
document.getElementById("install-domain").addEventListener("input", syncInstallDomainState);
document.getElementById("install-port-random-btn").addEventListener("click", () => {
  document.getElementById("install-port").value = randomPort(document.getElementById("install-protocol").value);
});
document.getElementById("install-short-id-random-btn").addEventListener("click", () => {
  if (!document.getElementById("install-short-id").disabled) {
    document.getElementById("install-short-id").value = randomShortId();
  }
});

document.getElementById("refresh-all-btn").addEventListener("click", async () => {
  try {
    await refreshAll();
    await fetchInstallStatus();
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("install-submit-btn").addEventListener("click", async () => {
  try {
    if (state.installStatus?.running) {
      await cancelInstall();
    } else {
      await submitInstall();
    }
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("user-create-btn").addEventListener("click", async () => {
  try {
    await createUser();
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("subscription-save-btn").addEventListener("click", async () => {
  try {
    await saveSubscription();
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("subscription-reset-btn").addEventListener("click", async () => {
  try {
    await resetSubscription();
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("routing-add-btn").addEventListener("click", async () => {
  try {
    await addRouting();
  } catch (error) {
    notify(error.message);
  }
});

async function init() {
  localizeStaticText();
  setupSectionTabs();
  ensureInstallStatusCard();
  setActiveSection("install");
  syncInstallDefaults();
  renderInstallStatus(state.installStatus);
  try {
    await refreshAll();
    await fetchInstallStatus();
  } catch (error) {
    notify(`\u521d\u59cb\u5316\u5931\u8d25\uff1a${error.message}`);
    modeIndicatorBtn.textContent = "\u63a5\u53e3\u5f02\u5e38";
  }
}

init();
