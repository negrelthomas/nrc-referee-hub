/* Click by click walkthrough player for the guide pages.
   <div class="walk" data-steps='[{"img":"guide/img/a.jpg","cap":"Step one"}, ...]'></div>
   Shows one screenshot at a time with its caption, auto advances every few seconds, and can be stepped by hand. */
(function () {
  function build(host) {
    let steps = [];
    try { steps = JSON.parse(host.dataset.steps || "[]"); } catch (e) { return; }
    if (!steps.length) return;
    let i = 0, timer = null, playing = true;
    host.innerHTML = `<div class="walk-stage"><img alt=""><div class="walk-cap"></div></div>
      <div class="walk-bar"><button class="btn sm ghost" data-act="prev" type="button">Previous</button>
      <button class="btn sm secondary" data-act="play" type="button">Pause</button>
      <button class="btn sm ghost" data-act="next" type="button">Next</button>
      <span class="walk-count"></span><span class="walk-dots"></span></div>`;
    const img = host.querySelector("img"), cap = host.querySelector(".walk-cap"), count = host.querySelector(".walk-count"), dots = host.querySelector(".walk-dots");
    dots.innerHTML = steps.map((_, k) => `<i data-k="${k}"></i>`).join("");
    steps.forEach(s => { const pre = new Image(); pre.src = s.img; });
    const show = () => {
      img.style.opacity = 0;
      setTimeout(() => { img.src = steps[i].img; img.alt = steps[i].cap; img.style.opacity = 1; }, 120);
      cap.innerHTML = `<strong>${i + 1}.</strong> ${steps[i].cap}`;
      count.textContent = `${i + 1} / ${steps.length}`;
      dots.querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k === i));
    };
    const go = (d) => { i = (i + d + steps.length) % steps.length; show(); };
    const start = () => { clearInterval(timer); timer = setInterval(() => go(1), 4500); playing = true; host.querySelector('[data-act="play"]').textContent = "Pause"; };
    const stop = () => { clearInterval(timer); playing = false; host.querySelector('[data-act="play"]').textContent = "Play"; };
    host.querySelector('[data-act="prev"]').onclick = () => { stop(); go(-1); };
    host.querySelector('[data-act="next"]').onclick = () => { stop(); go(1); };
    host.querySelector('[data-act="play"]').onclick = () => playing ? stop() : start();
    dots.onclick = (e) => { const k = e.target.dataset.k; if (k == null) return; stop(); i = +k; show(); };
    img.onclick = () => { stop(); go(1); };
    show();
    // play only while visible, so several players on one page do not all run
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting && playing) start(); else clearInterval(timer); }), { threshold: 0.4 }).observe(host);
    } else start();
  }
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(".walk").forEach(build));
})();
