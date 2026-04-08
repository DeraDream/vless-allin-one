const sections = {
  install: { title: "安装协议", heading: "安装协议", command: "POST /api/install" },
  core: { title: "核心版本管理", heading: "核心版本管理", command: "GET /api/cores · POST /api/core/update" },
  uninstall: { title: "卸载协议", heading: "卸载协议", command: "GET /api/protocols · POST /api/uninstall" },
  users: { title: "用户管理", heading: "用户管理", command: "GET /api/users · POST|DELETE /api/users" },
  subscription: { title: "订阅服务", heading: "订阅服务", command: "GET /api/subscriptions · POST /api/subscriptions/reset" },
  routing: { title: "分流管理", heading: "分流管理", command: "GET /api/routing · POST|DELETE /api/routing" },
};

const state = {
  protocols: [],
  cores: [],
  users: [],
  subscriptions: [],
  routing: [],
};

const menuItems = document.querySelectorAll(".menu-item");
const contentSections = document.querySelectorAll(".section");
const pageTitle = document.getElementById("page-title");
const sectionHeading = document.getElementById("section-heading");
const commandPreview = document.getElementById("command-preview");
const toastMessage = document.getElementById("toast-message");
const modeIndicatorBtn = document.getElementById("mode-indicator-btn");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "请求失败");
  }
  return result.data ?? result;
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
}

function renderDashboard(data) {
  document.getElementById("stat-installed").textContent = `${data.stats.installed} Protocols`;
  document.getElementById("stat-installed-sub").textContent = "前端已连上后端 API";
  document.getElementById("stat-users").textContent = `${data.stats.users}`;
  document.getElementById("stat-users-sub").textContent = `${data.stats.expiring} warning / disabled`;
  document.getElementById("stat-routing").textContent = `${data.stats.routes} Rules`;
  document.getElementById("stat-routing-sub").textContent = "分流与用户数据联动";

  const timeline = document.getElementById("timeline-list");
  timeline.innerHTML = data.logs.length
    ? data.logs
        .map(
          (item) => `
            <article>
              <span class="timeline-time">${item.created_at?.slice(11, 16) || "--:--"}</span>
              <div>
                <strong>${item.action}</strong>
                <p>${item.detail}</p>
              </div>
            </article>
          `
        )
        .join("")
    : "<p>暂无日志</p>";
}

function renderProtocols() {
  const body = document.getElementById("protocol-table-body");
  body.innerHTML = state.protocols
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.core}</td>
          <td>${item.port}</td>
          <td>${item.service}</td>
          <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
          <td><button class="danger-btn" data-uninstall-id="${item.id}">卸载</button></td>
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
          <td>${item.name}</td>
          <td>${item.current_version}</td>
          <td>${item.latest_version}</td>
          <td>${item.channel}</td>
          <td><button class="link-btn" data-core-name="${item.name}" data-core-target="${item.latest_version}">更新</button></td>
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
          <td>${item.username}</td>
          <td>${item.protocol}</td>
          <td>${item.port}</td>
          <td>${Number(item.used_gb).toFixed(1)} GB</td>
          <td>${Number(item.quota_gb).toFixed(1)} GB</td>
          <td>${item.expire_at}</td>
          <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
          <td><button class="danger-btn" data-user-delete-id="${item.id}">删除</button></td>
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
          <td>${item.rule_type}</td>
          <td>${item.target}</td>
          <td>${item.outbound}</td>
          <td>${item.ip_strategy}</td>
          <td>${item.priority}</td>
          <td><button class="danger-btn" data-routing-delete-id="${item.id}">删除</button></td>
        </tr>
      `
    )
    .join("");
}

async function refreshAll() {
  const [dashboard, protocols, cores, users, subscriptions, routing] = await Promise.all([
    api("/api/dashboard"),
    api("/api/protocols"),
    api("/api/cores"),
    api("/api/users"),
    api("/api/subscriptions"),
    api("/api/routing"),
  ]);

  state.protocols = protocols;
  state.cores = cores;
  state.users = users;
  state.subscriptions = subscriptions;
  state.routing = routing;

  renderDashboard(dashboard);
  renderProtocols();
  renderCores();
  renderUsers();
  renderSubscriptions();
  renderRouting();
  notify("面板数据已同步");
}

async function submitInstall() {
  const payload = {
    protocol: document.getElementById("install-protocol").value,
    port: document.getElementById("install-port").value,
    domain: document.getElementById("install-domain").value,
    cert_mode: document.getElementById("install-cert-mode").value,
    notes: document.getElementById("install-notes").value,
    core: document.getElementById("install-core").value,
    transport: document.getElementById("install-transport").value,
  };
  const result = await api("/api/install", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notify(result.message);
  await refreshAll();
}

async function createUser() {
  const payload = {
    username: document.getElementById("user-name").value,
    protocol: document.getElementById("user-protocol").value,
    port: document.getElementById("user-port").value,
    quota_gb: document.getElementById("user-quota").value,
    expire_at: document.getElementById("user-expire").value,
    status: document.getElementById("user-status").value,
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
    rule_type: document.getElementById("routing-type").value,
    target: document.getElementById("routing-target").value,
    outbound: document.getElementById("routing-outbound").value,
    ip_strategy: document.getElementById("routing-ip-strategy").value,
    priority: document.getElementById("routing-priority").value,
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
  if (!current) return;
  const result = await api("/api/subscriptions/reset", {
    method: "POST",
    body: JSON.stringify({ id: current.id }),
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

document.getElementById("refresh-all-btn").addEventListener("click", async () => {
  try {
    await refreshAll();
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById("install-submit-btn").addEventListener("click", async () => {
  try {
    await submitInstall();
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
  setActiveSection("install");
  try {
    await refreshAll();
    modeIndicatorBtn.textContent = "API Connected";
  } catch (error) {
    notify(`初始化失败: ${error.message}`);
    modeIndicatorBtn.textContent = "API Error";
  }
}

init();
