const sections = {
  install: { title: "\u5b89\u88c5\u534f\u8bae", heading: "\u5b89\u88c5\u534f\u8bae", command: "POST /api/install" },
  core: { title: "\u6838\u5fc3\u7248\u672c", heading: "\u6838\u5fc3\u7248\u672c", command: "GET /api/cores | POST /api/core/update" },
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
  stopped: "\u5df2\u505c\u6b62",
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
  coreChannels: {},
  users: [],
  subscriptions: [],
  routing: [],
  userRoutingOptions: [],
  logs: [],
  activeTab: "form",
  currentSection: "install",
  serverLogs: [],
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
  const length = 8;
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

function formatUserRoutingLabel(value) {
  if (!value || value === "default") return "\u5168\u5c40\u89c4\u5219";
  if (value === "direct") return "\u76f4\u8fde";
  if (value.startsWith("chain:")) return `\u94fe\u5f0f: ${value.slice(6)}`;
  if (value.startsWith("balancer:")) return `\u8d1f\u8f7d\u5747\u8861: ${value.slice(9)}`;
  if (value === "warp") return "WARP";
  return value;
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
  return;
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

function ensureInstallProtocolList() {
  if (document.getElementById("install-protocol-table-body")) return;
  const installSection = document.getElementById("install");
  const sectionLayout = installSection?.querySelector(".section-layout");
  if (!installSection || !sectionLayout) return;

  const block = document.createElement("div");
  block.className = "mini-card install-list-card";
  block.innerHTML = `
    <div class="block-head">
      <div>
        <h4>\u5df2\u5b89\u88c5\u534f\u8bae</h4>
        <p>\u8fd9\u91cc\u53ef\u4ee5\u76f4\u63a5\u67e5\u770b\u5df2\u5b89\u88c5\u534f\u8bae\u5e76\u5378\u8f7d\u3002</p>
      </div>
    </div>
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>\u534f\u8bae</th>
            <th>\u6838\u5fc3</th>
            <th>\u7aef\u53e3</th>
            <th>\u670d\u52a1</th>
            <th>\u72b6\u6001</th>
            <th>\u64cd\u4f5c</th>
          </tr>
        </thead>
        <tbody id="install-protocol-table-body"></tbody>
      </table>
    </div>
  `;

  sectionLayout.insertBefore(block, sectionLayout.firstChild);
}

function ensureLogPanel() {
  const sidePanel = document.querySelector(".panel.panel-side");
  if (!sidePanel) return;

  const timeline = sidePanel.querySelector(".timeline");
  if (timeline) timeline.remove();
  const divider = sidePanel.querySelector(".panel-divider");
  if (divider) divider.remove();
  const commandBox = sidePanel.querySelector(".command-box");
  if (commandBox) commandBox.remove();

  const headKicker = sidePanel.querySelector(".panel-head .panel-kicker");
  const headTitle = sidePanel.querySelector(".panel-head h3");
  if (headKicker) headKicker.textContent = "\u670d\u52a1\u5668\u65e5\u5fd7";
  if (headTitle) headTitle.textContent = "\u5b9e\u65f6 SSH \u65e5\u5fd7";

  if (document.getElementById("server-log-list")) return;

  const box = document.createElement("section");
  box.className = "server-log-box";
  box.innerHTML = `
    <div class="server-log-meta">
      <span id="server-log-status">\u6b63\u5728\u540c\u6b65\u670d\u52a1\u5668\u65e5\u5fd7...</span>
    </div>
    <div class="server-log-list" id="server-log-list"></div>
  `;
  sidePanel.appendChild(box);
}

function applySectionLayout(sectionKey) {
  const sidePanel = document.querySelector(".panel.panel-side");
  const contentGrid = document.querySelector(".content-grid");
  const installStatusCard = document.getElementById("install-status-card");
  if (!sidePanel || !contentGrid) return;

  const showSidePanel = sectionKey !== "routing";
  sidePanel.hidden = !showSidePanel;
  contentGrid.classList.toggle("single-column", !showSidePanel);
  if (installStatusCard) {
    installStatusCard.hidden = sectionKey !== "install";
  }
}

function refineSections() {
  const usersSection = document.getElementById("users");
  const usersCards = usersSection?.querySelector(".cards-3");
  const usersTable = usersSection?.querySelector(".table-shell");
  if (usersCards && usersTable && usersTable.nextElementSibling !== usersCards) {
    usersSection.appendChild(usersCards);
  }
}

function setActiveTab(tab) {
  state.activeTab = "form";
}

function setupSectionTabs() {
  if (segmentControl) {
    segmentControl.innerHTML = "";
    segmentControl.hidden = true;
  }
}

function localizeStaticText() {
  document.title = "VLESS \u670d\u52a1\u9762\u677f";
  document.querySelector(".brand-kicker").textContent = "\u514d\u767b\u5f55\u63a7\u5236\u53f0";
  document.querySelector(".brand h1").textContent = "VLESS \u670d\u52a1\u9762\u677f";
  document.querySelector(".sidebar-note").textContent =
    "\u9762\u677f\u9ed8\u8ba4\u9762\u5411 Linux Live \u6a21\u5f0f\uff0c\u5b89\u88c5\u3001\u66f4\u65b0\u3001\u5378\u8f7d\u548c\u6392\u969c\u90fd\u4f1a\u76f4\u63a5\u8fde\u63a5\u771f\u5b9e\u670d\u52a1\u5668\u73af\u5883\u3002";
  document.querySelector(".sidebar-footer strong").textContent = "Linux \u7ebf\u4e0a\u8fd0\u7ef4";
  document.querySelector(".status-card p").textContent = "\u5f53\u524d\u6a21\u5f0f";
  document.querySelector(".eyebrow").textContent = "\u591a\u534f\u8bae\u53ef\u89c6\u5316\u63a7\u5236\u9762\u677f";
  document.getElementById("refresh-all-btn").textContent = "\u540c\u6b65\u9762\u677f\u6570\u636e";
  document.querySelector(".hero-tag").textContent = "Linux \u4e00\u952e\u5b89\u88c5 + \u7ebf\u4e0a\u8fd0\u7ef4";
  document.querySelector(".hero h3").textContent =
    "\u628a\u811a\u672c\u80fd\u529b\u76f4\u63a5\u63a5\u6210 Linux \u7ebf\u4e0a\u8fd0\u7ef4\u9762\u677f\uff0c\u652f\u6301\u4e00\u952e\u5b89\u88c5\u548c\u5b9e\u65f6\u65e5\u5fd7\u6392\u969c";
  document.querySelector(".hero p:not(.hero-tag)").textContent =
    "\u8fd9\u4e2a\u9762\u677f\u56f4\u7ed5\u5b89\u88c5\u534f\u8bae\u3001\u6838\u5fc3\u7ba1\u7406\u3001\u7528\u6237\u3001\u8ba2\u9605\u548c\u5206\u6d41\u4e94\u7c7b\u64cd\u4f5c\u7ec4\u7ec7\uff0c\u9762\u5411 Linux Live \u6a21\u5f0f\u76f4\u63a5\u7ba1\u7406\u771f\u5b9e\u670d\u52a1\u5668\u811a\u672c\u73af\u5883\u3002";

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
  userLabels[5].childNodes[0].textContent = "\u7528\u6237\u8def\u7531\n                  ";
  userLabels[6].childNodes[0].textContent = "\u72b6\u6001\n                  ";
  document.querySelector('#user-status option[value="enabled"]').textContent = "\u5df2\u542f\u7528";
  document.querySelector('#user-status option[value="warning"]').textContent = "\u544a\u8b66";
  document.querySelector('#user-status option[value="disabled"]').textContent = "\u5df2\u505c\u7528";
  document.getElementById("user-create-btn").textContent = "\u65b0\u589e\u7528\u6237";
  const userHeaders = document.querySelectorAll("#users th");
  userHeaders[0].textContent = "\u7528\u6237\u540d";
  userHeaders[1].textContent = "\u534f\u8bae";
  userHeaders[2].textContent = "\u7aef\u53e3";
  userHeaders[3].textContent = "\u7528\u6237\u8def\u7531";
  userHeaders[4].textContent = "\u5df2\u7528\u6d41\u91cf";
  userHeaders[5].textContent = "\u914d\u989d";
  userHeaders[6].textContent = "\u5230\u671f\u65f6\u95f4";
  userHeaders[7].textContent = "\u72b6\u6001";
  userHeaders[8].textContent = "\u64cd\u4f5c";

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

  document.querySelector(".panel.panel-side .panel-kicker").textContent = "\u670d\u52a1\u5668\u65e5\u5fd7";
  document.querySelector(".panel.panel-side h3").textContent = "\u5b9e\u65f6 SSH \u65e5\u5fd7";
  toastMessage.textContent = "\u9762\u677f\u5df2\u5c31\u7eea\uff0c\u7b49\u5f85\u52a0\u8f7d\u6570\u636e\u3002";
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
  if (toastMessage) {
    toastMessage.textContent = message;
  }
  const logStatus = document.getElementById("server-log-status");
  if (logStatus) {
    logStatus.textContent = message;
  }
}

function setButtonLoading(button, loading, loadingText = "\u5904\u7406\u4e2d...", idleText = "") {
  if (!button) return;
  if (!button.dataset.idleText) {
    button.dataset.idleText = idleText || button.textContent;
  }
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.textContent = loading ? loadingText : button.dataset.idleText;
}

function badgeClass(status) {
  if (status === "running" || status === "enabled") return "green";
  if (status === "warning" || status === "manual") return "amber";
  if (status === "stopped" || status === "disabled") return "red";
  return "red";
}

function setActiveSection(key) {
  const current = sections[key];
  if (!current) return;
  state.currentSection = key;

  menuItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.section === key);
  });

  contentSections.forEach((section) => {
    section.classList.toggle("is-visible", section.id === key);
  });

  pageTitle.textContent = current.title;
  sectionHeading.textContent = current.heading;
  if (commandPreview) {
    commandPreview.textContent = current.command;
  }
  setActiveTab(state.activeTab);
  applySectionLayout(key);
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

}

function renderProtocols() {
  const markup = state.protocols
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

  const installBody = document.getElementById("install-protocol-table-body");
  if (installBody) installBody.innerHTML = markup;
}

function renderUserRoutingOptions() {
  const select = document.getElementById("user-routing");
  if (!select) return;

  const currentValue = select.value;
  const options = Array.isArray(state.userRoutingOptions) && state.userRoutingOptions.length
    ? state.userRoutingOptions
    : [{ value: "", label: "\u5168\u5c40\u89c4\u5219" }, { value: "direct", label: "\u76f4\u8fde" }];

  select.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join("");

  const hasCurrent = options.some((item) => item.value === currentValue);
  select.value = hasCurrent ? currentValue : "";
}

function selectedCoreChannel(name, fallback = "stable") {
  return state.coreChannels[name] || fallback || "stable";
}

function coreTargetVersion(item) {
  const channel = selectedCoreChannel(item.name, item.channel);
  if (channel === "beta") {
    return item.beta_version || item.latest_version || "unknown";
  }
  return item.stable_version || item.latest_version || "unknown";
}

function renderCores() {
  const body = document.getElementById("core-table-body");
  body.innerHTML = state.cores
    .map(
      (item) => {
        const channel = selectedCoreChannel(item.name, item.channel);
        const targetVersion = coreTargetVersion(item);
        const currentVersion = item.current_version || "unknown";
        const disableUpdate = !targetVersion || targetVersion === "unknown" || currentVersion === targetVersion;
        return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(currentVersion)}</td>
          <td>${escapeHtml(targetVersion)}</td>
          <td>
            <select class="core-channel-select" data-core-channel-name="${escapeHtml(item.name)}">
              <option value="stable" ${channel === "stable" ? "selected" : ""}>\u7a33\u5b9a\u6b63\u5f0f\u7248</option>
              <option value="beta" ${channel === "beta" ? "selected" : ""} ${item.name === "Snell v5" ? "disabled" : ""}>\u6d4b\u8bd5\u7248</option>
            </select>
          </td>
          <td>
            <div class="row-actions">
              <button class="link-btn" data-core-update-name="${escapeHtml(item.name)}" data-core-update-target="${escapeHtml(targetVersion)}" ${disableUpdate ? "disabled" : ""}>\u66f4\u65b0</button>
              <button class="danger-btn" data-core-uninstall-name="${escapeHtml(item.name)}">\u5378\u8f7d</button>
            </div>
          </td>
        </tr>
      `;
      }
    )
    .join("");
}

function renderUsers() {
  document.getElementById("users-total").textContent = String(state.users.length);
  document.getElementById("users-warning").textContent = String(state.users.filter((item) => item.status !== "enabled").length);
  document.getElementById("users-expiring").textContent = String(state.users.filter((item) => item.expire_at).length);
  renderUserRoutingOptions();

  const body = document.getElementById("user-table-body");
  body.innerHTML = state.users
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.username)}</td>
          <td>${escapeHtml(item.protocol)}</td>
          <td>${escapeHtml(item.port)}</td>
          <td>${escapeHtml(item.routing_label || formatUserRoutingLabel(item.routing))}</td>
          <td>${Number(item.used_gb).toFixed(1)} GB</td>
          <td>${Number(item.quota_gb).toFixed(1)} GB</td>
          <td>${escapeHtml(item.expire_at)}</td>
          <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(textOfStatus(item.status))}</span></td>
          <td>
            <div class="row-actions">
              <button class="ghost-btn" data-user-share-id="${escapeHtml(item.id)}">\u5bfc\u51fa\u94fe\u63a5</button>
              <button class="danger-btn" data-user-delete-id="${escapeHtml(item.id)}">\u5220\u9664</button>
            </div>
          </td>
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
  state.userRoutingOptions = meta.user_routing_options || [];
  state.coreChannels = Object.fromEntries(
    cores.map((item) => [item.name, state.coreChannels[item.name] || item.channel || "stable"])
  );
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

function renderServerLogs(payload) {
  const logList = document.getElementById("server-log-list");
  const status = document.getElementById("server-log-status");
  if (!logList || !status) return;

  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const shouldStick = logList.scrollTop + logList.clientHeight >= logList.scrollHeight - 40;
  status.textContent = lines.length
    ? `\u5df2\u52a0\u8f7d ${lines.length} \u6761\u670d\u52a1\u5668\u65e5\u5fd7`
    : "\u6682\u672a\u8bfb\u5230\u670d\u52a1\u5668\u65e5\u5fd7";
  logList.innerHTML = lines.length
    ? lines
        .map(
          (item) => `
            <article class="server-log-line ${item.level === "error" ? "is-error" : ""}">
              <span class="server-log-time">${escapeHtml(item.time || "--")}</span>
              <strong class="server-log-source">${escapeHtml(item.source || "server")}</strong>
              <p>${escapeHtml(item.message || "")}</p>
            </article>
          `
        )
        .join("")
    : `<p class="server-log-empty">\u6682\u65e0\u670d\u52a1\u5668\u65e5\u5fd7</p>`;

  if (shouldStick) {
    logList.scrollTop = logList.scrollHeight;
  }
}

async function fetchServerLogs() {
  const result = await api("/api/logs?limit=120");
  state.serverLogs = result.lines || [];
  renderServerLogs(result);
}

function startServerLogPolling() {
  window.setInterval(async () => {
    if (state.currentSection === "routing") return;
    try {
      await fetchServerLogs();
    } catch (error) {
      const status = document.getElementById("server-log-status");
      if (status) status.textContent = `\u65e5\u5fd7\u8bfb\u53d6\u5931\u8d25\uff1a${error.message}`;
    }
  }, 2000);
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
        await Promise.all([refreshAll(), fetchServerLogs()]);
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
    expire_at: document.getElementById("user-expire").value.trim(),
    routing: document.getElementById("user-routing")?.value ?? "",
    status: requireValue("user-status", "\u72b6\u6001"),
  };
  const result = await api("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notify(result.message);
  await refreshAll();
}

async function exportUserShareLink(userId) {
  const result = await api(`/api/users/share?id=${encodeURIComponent(userId)}`);
  const link = result.link || "";
  if (!link) {
    throw new Error("\u6ca1\u6709\u751f\u6210\u53ef\u7528\u94fe\u63a5");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link);
    notify(`\u5df2\u590d\u5236 ${result.username} \u7684\u94fe\u63a5`);
    return;
  }
  window.prompt("\u8bf7\u590d\u5236\u7528\u6237\u94fe\u63a5", link);
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
  const trigger = event.target.closest("button");
  if (!trigger) return;

  const uninstallId = trigger.dataset.uninstallId;
  const coreUpdateName = trigger.dataset.coreUpdateName;
  const coreUpdateTarget = trigger.dataset.coreUpdateTarget;
  const coreUninstallName = trigger.dataset.coreUninstallName;
  const userDeleteId = trigger.dataset.userDeleteId;
  const userShareId = trigger.dataset.userShareId;
  const routingDeleteId = trigger.dataset.routingDeleteId;

  try {
    if (uninstallId) {
      if (!window.confirm("\u786e\u8ba4\u5378\u8f7d\u8fd9\u4e2a\u534f\u8bae\u5417\uff1f")) return;
      const result = await api("/api/uninstall", {
        method: "POST",
        body: JSON.stringify({ id: uninstallId }),
      });
      notify(result.message);
      await refreshAll();
      await fetchServerLogs();
    } else if (coreUpdateName) {
      const channel = selectedCoreChannel(coreUpdateName, "stable");
      const result = await api("/api/core/update", {
        method: "POST",
        body: JSON.stringify({ name: coreUpdateName, target_version: coreUpdateTarget, channel }),
      });
      notify(result.message);
      await refreshAll();
      await fetchServerLogs();
    } else if (coreUninstallName) {
      if (!window.confirm(`\u786e\u8ba4\u5378\u8f7d ${coreUninstallName} \u5417\uff1f`)) return;
      const result = await api("/api/core/uninstall", {
          method: "POST",
          body: JSON.stringify({ name: coreUninstallName }),
        });
        notify(result.message);
        await refreshAll();
        await fetchServerLogs();
      } else if (userShareId) {
        setButtonLoading(trigger, true, "\u751f\u6210\u4e2d...");
        await exportUserShareLink(userShareId);
      } else if (userDeleteId) {
        if (!window.confirm("\u786e\u8ba4\u5220\u9664\u8fd9\u4e2a\u7528\u6237\u5417\uff1f")) return;
        const result = await api("/api/users", {
        method: "DELETE",
        body: JSON.stringify({ id: userDeleteId }),
      });
      notify(result.message);
      await refreshAll();
      await fetchServerLogs();
    } else if (routingDeleteId) {
      if (!window.confirm("\u786e\u8ba4\u5220\u9664\u8fd9\u6761\u5206\u6d41\u89c4\u5219\u5417\uff1f")) return;
      const result = await api("/api/routing", {
        method: "DELETE",
        body: JSON.stringify({ id: routingDeleteId }),
      });
      notify(result.message);
      await refreshAll();
        await fetchServerLogs();
      }
    } catch (error) {
      notify(error.message);
    } finally {
      if (userShareId) {
        setButtonLoading(trigger, false);
      }
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
document.addEventListener("change", (event) => {
  if (event.target.matches(".core-channel-select")) {
    state.coreChannels[event.target.dataset.coreChannelName] = event.target.value;
    renderCores();
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
  const button = document.getElementById("user-create-btn");
  try {
    setButtonLoading(button, true, "\u521b\u5efa\u4e2d...");
    notify("\u6b63\u5728\u521b\u5efa\u7528\u6237\u5e76\u4e0b\u53d1\u914d\u7f6e...");
    await createUser();
  } catch (error) {
    notify(error.message);
  } finally {
    setButtonLoading(button, false);
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
  ensureInstallProtocolList();
  ensureLogPanel();
  ensureInstallStatusCard();
  refineSections();
  setActiveSection("install");
  syncInstallDefaults();
  renderInstallStatus(state.installStatus);
  try {
    await refreshAll();
    await fetchInstallStatus();
    await fetchServerLogs();
    startServerLogPolling();
  } catch (error) {
    notify(`\u521d\u59cb\u5316\u5931\u8d25\uff1a${error.message}`);
    modeIndicatorBtn.textContent = "\u63a5\u53e3\u5f02\u5e38";
  }
}

init();
