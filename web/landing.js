/* 大观园落地页交互：学科轮播 + 导航高亮 + 书页动画开关 */
(() => {
  "use strict";

  const subjects = [
    {
      name: "考研数学",
      status: "开放",
      desc: "真题、讲义、刷题入口已开放。",
      action: { label: "进入学习", href: "./index.html" },
      graphic: "math",
    },
    {
      name: "考研英语",
      status: "待开发",
      desc: "真题阅读、词汇与作文模板整理中。",
      action: { label: "敬请期待", disabled: true },
      icon: "language",
    },
    {
      name: "408 计算机专业课",
      status: "待开发",
      desc: "数据结构、组成原理、操作系统、网络知识预留。",
      action: { label: "敬请期待", disabled: true },
      icon: "cube",
    },
    {
      name: "思想政治",
      status: "开放",
      desc: "帕拉迪宇资料使用与问卷评价。",
      action: { label: "查看资料", href: "https://www.cxyonly.fans/", external: true },
      icon: "world",
    },
    {
      name: "Bilibili 投稿合集",
      status: "待开发",
      desc: "题目整理、视频教程与专题合集收录区。",
      action: { label: "敬请期待", disabled: true },
      icon: "tv",
    },
  ];

  const POSITIONS = ["center", "right", "off-right", "off-left", "left"];
  const ICONS = {
    language: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" class="subject-icon"><path d="M3 5h9"></path><path d="M12 19h9"></path><path d="M7.5 3v2c0 4.415 -3.342 8.117 -7.5 8.8"></path><path d="M5.5 9.5c1.205 2.85 3.823 5.04 7 5.7"></path><path d="M12.5 3l5 16"></path><path d="M14 11h6.5"></path></svg>',
    cube: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" class="subject-icon"><path d="M21.008 7.977v8.046a2 2 0 0 1 -1.007 1.733l-7 4.045a2 2 0 0 1 -1.997 0l-7-4.046a2 2 0 0 1 -1.004 -1.733v-8.045a2 2 0 0 1 1.004 -1.733l7-4.045a2 2 0 0 1 1.997 0l7 4.045a2 2 0 0 1 1.007 1.733z"></path><path d="M12 11.017l8.64 -4.989"></path><path d="M3.392 6.051l8.608 4.966v10.06"></path></svg>',
    world: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" class="subject-icon"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M3.6 9h16.8"></path><path d="M3.6 15h16.8"></path><path d="M11.5 3a17 17 0 0 0 0 18"></path><path d="M12.5 3a17 17 0 0 1 0 18"></path></svg>',
    tv: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" class="subject-icon"><path d="M21.008 11.977v7.046a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2h12"></path><path d="M17 8l3.5 -3.5"></path><path d="M20.5 8l-3.5 -3.5"></path><path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M10 12v-1.5a1.5 1.5 0 0 1 3 0v1.5"></path></svg>',
  };

  const map = document.querySelector(".resource-map");
  const tabsBox = document.getElementById("subject-tabs");
  const live = document.getElementById("subject-live");
  if (!map || !tabsBox) return;

  // 考研数学的三维正弦曲面线框图（与官网视觉一致的程序化绘制）
  function buildMathSurface() {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 320 140");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("math-surface");
    const rows = 13, cols = 96;
    for (let r = 0; r < rows; r++) {
      const pts = [];
      for (let c = 0; c <= cols; c++) {
        const x = 32 + (256 * c) / cols;
        const t = (c / cols) * Math.PI * 2;
        const depth = 1 - Math.abs(r / (rows - 1) - 0.5) * 1.1;
        const y = 74 + (r - (rows - 1) / 2) * 4.1 + Math.sin(t) * 17 * depth;
        pts.push(x.toFixed(3) + "," + y.toFixed(3));
      }
      const pl = document.createElementNS(svgNs, "polyline");
      pl.setAttribute("points", pts.join(" "));
      pl.setAttribute("stroke", "#6c93ff");
      pl.setAttribute("stroke-width", "0.7");
      pl.setAttribute("opacity", (0.28 + 0.5 * Math.pow(1 - Math.abs(r / (rows - 1) - 0.5) * 2, 2)).toFixed(3));
      svg.appendChild(pl);
    }
    // 主曲线
    const main = [];
    for (let c = 0; c <= cols; c++) {
      const x = 32 + (256 * c) / cols;
      const y = 74 + Math.sin((c / cols) * Math.PI * 2) * 17;
      main.push(x.toFixed(3) + "," + y.toFixed(3));
    }
    const mainLine = document.createElementNS(svgNs, "polyline");
    mainLine.setAttribute("points", main.join(" "));
    mainLine.setAttribute("stroke", "#1550ff");
    mainLine.setAttribute("stroke-width", "1.6");
    svg.appendChild(mainLine);
    // 坐标轴
    const axis = document.createElementNS(svgNs, "path");
    axis.setAttribute("d", "M32 74 L296 74 M52 26 L52 128");
    axis.setAttribute("stroke", "#a9c0ff");
    axis.setAttribute("stroke-width", "0.8");
    svg.appendChild(axis);
    return svg;
  }

  const nodes = subjects.map((subject, index) => {
    const article = document.createElement("article");
    article.className = "subject-node";
    article.setAttribute("data-position", POSITIONS[index] || "off-left");
    article.setAttribute("data-active", String(index === 0));
    article.setAttribute("data-visible", String(POSITIONS[index] !== "off-left" && POSITIONS[index] !== "off-right"));
    article.setAttribute("aria-hidden", String(!(POSITIONS[index] === "center")));

    const select = document.createElement("button");
    select.type = "button";
    select.className = "subject-select";
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-label", "查看" + subject.name);
    const graphic = document.createElement("span");
    graphic.className = "subject-graphic";
    if (subject.graphic === "math") {
      graphic.appendChild(buildMathSurface());
    } else {
      const wrap = document.createElement("span");
      wrap.style.display = "grid";
      wrap.style.placeItems = "center";
      wrap.innerHTML = ICONS[subject.icon] || "";
      graphic.appendChild(wrap);
    }
    const title = document.createElement("span");
    title.className = "subject-title";
    title.textContent = subject.name;
    select.appendChild(graphic);
    select.appendChild(title);

    const copy = document.createElement("div");
    copy.className = "subject-copy";
    const detail = document.createElement("div");
    detail.className = "subject-detail";
    const p = document.createElement("p");
    p.textContent = subject.desc;
    detail.appendChild(p);
    const action = document.createElement("a");
    action.className = "subject-action";
    if (subject.action.href) {
      action.href = subject.action.href;
      if (subject.action.external) { action.target = "_blank"; action.rel = "noreferrer"; }
    } else {
      action.setAttribute("role", "button");
      action.setAttribute("aria-disabled", "true");
      action.classList.add("is-disabled");
      action.style.cursor = "default";
    }
    action.innerHTML = subject.action.label +
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l14 0"></path><path d="M13 6l6 6"></path><path d="M13 18l6 -6"></path></svg>';
    detail.appendChild(action);
    const status = document.createElement("p");
    status.className = "subject-status";
    status.textContent = subject.status;
    copy.appendChild(detail);
    copy.appendChild(status);

    article.appendChild(select);
    article.appendChild(copy);
    map.appendChild(article);
    return article;
  });

  const tabs = subjects.map((subject, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(index === 0));
    btn.textContent = subject.name;
    btn.addEventListener("click", () => setActive(index));
    tabsBox.appendChild(btn);
    return btn;
  });

  let active = 0;
  function setActive(index) {
    active = ((index % subjects.length) + subjects.length) % subjects.length;
    nodes.forEach((node, i) => {
      const offset = ((i - active) % subjects.length + subjects.length) % subjects.length;
      const position = POSITIONS[offset];
      node.setAttribute("data-position", position);
      node.setAttribute("data-active", String(offset === 0));
      node.setAttribute("data-visible", String(offset < 4));
      node.setAttribute("aria-hidden", String(offset !== 0));
    });
    tabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === active)));
    live.textContent = "当前学科：" + subjects[active].name + "，" + (subjects[active].status === "开放" ? "开放" : "待开发");
  }

  document.getElementById("btn-subject-prev").addEventListener("click", () => setActive(active - 1));
  document.getElementById("btn-subject-next").addEventListener("click", () => setActive(active + 1));

  // 顶部导航：滚动定位 + 当前节高亮
  const sections = ["hero", "resources", "follow"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const navLinks = Array.from(document.querySelectorAll(".nav-link"));
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  const progressIndex = document.getElementById("nav-progress-index");
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navLinks.forEach((link) => {
          const isActive = link.dataset.target === id;
          link.classList.toggle("is-active", isActive);
          if (isActive) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
        if (progressIndex) {
          progressIndex.textContent = String(sections.indexOf(entry.target) + 1).padStart(2, "0");
        }
      });
    },
    { rootMargin: "-45% 0px -45% 0px" }
  );
  sections.forEach((section) => sectionObserver.observe(section));

  const viewResources = document.getElementById("btn-view-resources");
  if (viewResources) {
    viewResources.addEventListener("click", () => {
      const target = document.getElementById("resources");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // 书页动画暂停开关
  const motionToggle = document.getElementById("btn-motion-toggle");
  const fallbackImage = document.querySelector(".geometry-fallback");
  if (motionToggle && fallbackImage) {
    let paused = false;
    motionToggle.addEventListener("click", () => {
      paused = !paused;
      fallbackImage.classList.toggle("is-animated", !paused);
      motionToggle.setAttribute("aria-label", paused ? "播放书页动画" : "暂停书页动画");
    });
  }
})();
