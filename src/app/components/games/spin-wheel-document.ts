import { WHEEL_SEGMENTS, WHEEL_SPIN_ORDER } from './game-banks';

/**
 * The self-contained document rendered inside the Game Shell's sandboxed
 * `<iframe>`.
 *
 * Why a document at all: the shell's third embedded mode has to prove it can
 * host content it does not run itself. This HTML ships no network request, no
 * CDN and no dependency — it is a literal, generated from the same banks the
 * React side uses — and it is loaded with `sandbox="allow-scripts"` and
 * deliberately WITHOUT `allow-same-origin`, so it executes in an opaque origin
 * that cannot reach the member's session, cookies or DOM. Its only channel back
 * is `postMessage`.
 *
 * Deterministic by construction: the spin order is the fixed permutation in
 * `WHEEL_SPIN_ORDER`, so the wheel covers every segment once before repeating —
 * no `Math.random()` in this document.
 */

const SEGMENT_COLOURS = [
  '#7C3AED',
  '#A855F7',
  '#D4B18A',
  '#10B981',
  '#EC4899',
  '#3B82F6',
] as const;

function buildDocument(): string {
  const segmentCount = WHEEL_SEGMENTS.length;
  const sweep = 360 / segmentCount;

  const stops = WHEEL_SEGMENTS.map((segment, index) => {
    const from = index * sweep;
    const colour = SEGMENT_COLOURS[index % SEGMENT_COLOURS.length];
    return `${colour} ${from}deg ${from + sweep}deg`;
  }).join(', ');

  const legend = WHEEL_SEGMENTS.map(
    (segment, index) =>
      `<li id="legend-${segment.id}" data-index="${index}"><b>${index + 1}</b> ${segment.label}</li>`
  ).join('');

  const labels = JSON.stringify(WHEEL_SEGMENTS.map((segment) => segment.label));
  const order = JSON.stringify([...WHEEL_SPIN_ORDER]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spin the Wheel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #0D0A10; color: #F2E9E4;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .wheelWrap { position: relative; width: 200px; height: 200px; }
  .pointer {
    position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
    width: 0; height: 0; border-left: 10px solid transparent;
    border-right: 10px solid transparent; border-top: 18px solid #D4B18A; z-index: 2;
  }
  .wheel {
    width: 200px; height: 200px; border-radius: 50%;
    border: 4px solid #0D0A10; box-shadow: 0 0 0 2px #4A1828;
    transition: transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
  }
  .hub {
    position: absolute; inset: 82px; border-radius: 50%;
    background: #1C1822; border: 2px solid #4A1828; z-index: 1;
  }
  button {
    padding: 12px 30px; border-radius: 30px; border: none; cursor: pointer;
    background: linear-gradient(135deg, #7C3AED, #A855F7); color: #fff;
    font-size: 15px; font-weight: 800; font-family: inherit;
  }
  button:disabled { background: #29202D; color: #B58A83; cursor: default; }
  #status { font-size: 13px; font-weight: 700; color: #D4B18A; min-height: 18px; margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; gap: 4px; }
  li { font-size: 11px; color: #B58A83; padding: 4px 8px; border-radius: 8px; }
  li b { color: #7C3AED; margin-right: 6px; }
  li.won { background: #14321F; color: #86EFAC; }
</style>
</head>
<body>
  <div class="wheelWrap">
    <div class="pointer"></div>
    <div class="wheel" id="wheel" style="background: conic-gradient(from -30deg, ${stops})"></div>
    <div class="hub"></div>
  </div>
  <button id="spin" type="button">SPIN</button>
  <p id="status">Tap SPIN to land on a date idea.</p>
  <ul>${legend}</ul>
<script>
(function () {
  var LABELS = ${labels};
  var ORDER = ${order};
  var wheel = document.getElementById('wheel');
  var button = document.getElementById('spin');
  var status = document.getElementById('status');
  var cursor = 0;
  var turns = 0;
  var spinning = false;

  function post(message) {
    window.parent.postMessage(message, '*');
  }

  function mark(index) {
    var items = document.querySelectorAll('li[data-index]');
    for (var i = 0; i < items.length; i += 1) {
      items[i].className = Number(items[i].getAttribute('data-index')) === index ? 'won' : '';
    }
  }

  function announce() {
    post({ type: 'mettivo:ready', segments: LABELS.length, order: ORDER, remaining: ORDER.length - cursor });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'mettivo:hello') return;
    announce();
  });

  button.addEventListener('click', function () {
    if (spinning || cursor >= ORDER.length) return;

    var index = ORDER[cursor];
    cursor += 1;
    spinning = true;
    button.disabled = true;
    mark(index);

    turns += 3;
    wheel.style.transform = 'rotate(' + (turns * 360 - index * 60) + 'deg)';
    status.textContent = 'Spinning…';

    window.setTimeout(function () {
      spinning = false;
      var remaining = ORDER.length - cursor;
      status.textContent = LABELS[index];
      if (remaining > 0) {
        button.disabled = false;
      }
      post({
        type: 'mettivo:spin-result',
        index: index,
        label: LABELS[index],
        spin: cursor,
        remaining: remaining
      });
    }, 950);
  });

  announce();
})();
</script>
</body>
</html>`;
}

export const SPIN_WHEEL_DOCUMENT = buildDocument();
