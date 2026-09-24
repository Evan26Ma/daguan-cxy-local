(() => {
  "use strict";

  const tabs = [...document.querySelectorAll("[data-demo]")];
  const tablist = document.querySelector(".demo-tabs");
  const panels = [...document.querySelectorAll(".demo-panel")];
  const sidebarItems = [...document.querySelectorAll("[data-demo-nav]")];

  function selectDemo(tab, focus = false) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.id !== tab.getAttribute("aria-controls"); });
    sidebarItems.forEach((item) => item.classList.toggle("is-current", item.dataset.demoNav === tab.dataset.demo));
    if (focus) tab.focus();
  }

  if (tablist && tabs.length) {
    tablist.hidden = false;
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectDemo(tab));
      tab.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        selectDemo(tabs[next], true);
      });
    });
  }

  const answerToggle = document.getElementById("demo-answer-toggle");
  const answer = document.getElementById("demo-answer");
  if (answerToggle && answer) {
    answerToggle.hidden = false;
    answerToggle.addEventListener("click", () => {
      const expanded = answerToggle.getAttribute("aria-expanded") !== "true";
      answerToggle.setAttribute("aria-expanded", String(expanded));
      answer.hidden = !expanded;
      answerToggle.replaceChildren(document.createTextNode(expanded ? "收起解析 " : "试着展开解析 "));
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = expanded ? "−" : "＋";
      answerToggle.appendChild(mark);
    });
  }

  const menu = document.querySelector(".menu-toggle");
  const nav = document.getElementById("site-nav");
  if (menu && nav) {
    document.documentElement.classList.add("js-nav");
    const closeMenu = () => {
      nav.classList.remove("is-open");
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "打开导航");
    };
    menu.addEventListener("click", () => {
      const expanded = menu.getAttribute("aria-expanded") !== "true";
      nav.classList.toggle("is-open", expanded);
      menu.setAttribute("aria-expanded", String(expanded));
      menu.setAttribute("aria-label", expanded ? "关闭导航" : "打开导航");
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        closeMenu();
        menu.focus();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".site-header")) closeMenu();
    });
  }
})();
