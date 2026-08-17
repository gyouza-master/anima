/**
 * キャラクターの見た目（SVG プロシージャル生成）
 * cortex/src/avatar.ts を素の JS に移植したもの。
 *
 * 使い方: window.avatarSvg(look, state, size)
 *   look  = { id, color, body, deco, visor, mark }
 *   state = 'working' | 'waiting' | 'idle' | 'done' | 'error'
 */
(function () {
  const BODY = {
    slim:  { d: 'M50,18 h6 a16,16 0 0 1 16,16 v34 a16,16 0 0 1 -16,16 h-12 a16,16 0 0 1 -16,-16 v-34 a16,16 0 0 1 16,-16 z', top: 18, ey: 44, ch: { x: 50, y: 72 } },
    chibi: { d: 'M50,34 a23,23 0 0 1 23,23 v6 a23,23 0 0 1 -46,0 v-6 a23,23 0 0 1 23,-23 z', top: 34, ey: 58, ch: { x: 50, y: 76 } },
    wedge: { d: 'M24,32 h52 a4,4 0 0 1 4,5 l-9,42 a6,6 0 0 1 -6,5 h-30 a6,6 0 0 1 -6,-5 l-9,-42 a4,4 0 0 1 4,-5 z', top: 32, ey: 50, ch: { x: 50, y: 72 } },
    ball:  { d: 'M50,28 a27,27 0 1 1 -0.1,0 z', top: 28, ey: 54, ch: { x: 50, y: 72 } },
    dome:  { d: 'M13,84 v-20 a37,26 0 0 1 74,0 v20 a3,3 0 0 1 -3,3 h-68 a3,3 0 0 1 -3,-3 z', top: 40, ey: 64, ch: { x: 50, y: 79 } },
    egg:   { d: 'M50,20 c14,0 22,15 22,31 c0,18 -10,29 -22,29 c-12,0 -22,-11 -22,-29 c0,-16 8,-31 22,-31 z', top: 20, ey: 47, ch: { x: 50, y: 70 } },
  };

  const RING = { waiting: '#FBBF24', error: '#F87171' };

  function deco(l, g, st) {
    const b = BODY[l.body];
    const t = b.top;
    const S = `fill="none" stroke="${g}" stroke-linecap="round" stroke-linejoin="round"`;
    switch (l.deco) {
      case 'rod':
        return `<path d="M50,${t} V6" ${S} stroke-width="3"/><circle cx="50" cy="4" r="4" fill="${g}"/>`;
      case 'ears': {
        const z = st === 'idle' ? 6 : 0;
        return `<path d="M36,${t + 8} C24,${t - 2 + z} 20,${t - 20 + z} 27,${t - 24 + z} C34,${t - 27 + z} 38,${t - 8} 41,${t + 4}" fill="${g}" opacity=".9"/>
                <path d="M64,${t + 8} C76,${t - 2 + z} 80,${t - 20 + z} 73,${t - 24 + z} C66,${t - 27 + z} 62,${t - 8} 59,${t + 4}" fill="${g}" opacity=".9"/>`;
      }
      case 'horns':
        return `<path d="M31,${t + 2} L20,${t - 20} L42,${t - 1} z" fill="${g}"/><path d="M69,${t + 2} L80,${t - 20} L58,${t - 1} z" fill="${g}"/>`;
      case 'puffs':
        return `<circle cx="16" cy="44" r="12" fill="${g}" opacity=".9"/><circle cx="84" cy="44" r="12" fill="${g}" opacity=".9"/>`;
      case 'curl':
        return `<path d="M50,${t} C50,8 60,2 68,6 C76,10 74,22 65,20 C59,19 58,13 62,11" ${S} stroke-width="3.4"/>`;
      default:
        return '';
    }
  }

  function visorOf(l, y) {
    switch (l.visor) {
      case 'band':  return `<rect x="31" y="${y - 10}" width="38" height="20" rx="10" fill="#05080F"/>`;
      case 'oval':  return `<ellipse cx="50" cy="${y}" rx="21" ry="12.5" fill="#05080F"/>`;
      case 'slash': return `<path d="M29,${y - 4} L71,${y - 10} L71,${y + 6} L29,${y + 10} z" fill="#05080F"/>`;
      case 'slit':  return `<rect x="24" y="${y - 5}" width="52" height="10" rx="5" fill="#05080F"/>`;
      default:      return '';
    }
  }

  function markOf(l, g, p) {
    const o = `fill="none" stroke="${g}" stroke-width="2.2" stroke-linecap="round" opacity=".85"`;
    switch (l.mark) {
      case 'bar':  return `<rect x="${p.x - 6}" y="${p.y - 1.6}" width="12" height="3.2" rx="1.6" fill="${g}" opacity=".85"/>`;
      case 'dot':  return `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${g}" opacity=".85"/>`;
      case 'tri':  return `<path d="M${p.x},${p.y - 4} L${p.x + 4.5},${p.y + 3} L${p.x - 4.5},${p.y + 3} z" ${o}/>`;
      case 'ring': return `<circle cx="${p.x}" cy="${p.y}" r="4" ${o}/>`;
      case 'line': return `<path d="M${p.x - 7},${p.y} H${p.x + 7}" ${o}/>`;
      case 'star': return `<path d="M${p.x},${p.y - 4.5} L${p.x + 1.4},${p.y - 1} L${p.x + 4.8},${p.y - 1} L${p.x + 2},${p.y + 1.3} L${p.x + 3.2},${p.y + 4.8} L${p.x},${p.y + 2.6} L${p.x - 3.2},${p.y + 4.8} L${p.x - 2},${p.y + 1.3} L${p.x - 4.8},${p.y - 1} L${p.x - 1.4},${p.y - 1} z" fill="${g}" opacity=".8"/>`;
      default:     return '';
    }
  }

  function eyesOf(cy, g, st, narrow) {
    const sp = narrow ? 8 : 9.5;
    const L = 50 - sp;
    const R = 50 + sp;
    const S = `fill="none" stroke="${g}" stroke-linecap="round"`;
    switch (st) {
      case 'working':
        return `<rect x="${L - 5}" y="${cy - 1.7}" width="10" height="3.4" rx="1.7" fill="${g}"/><rect x="${R - 5}" y="${cy - 1.7}" width="10" height="3.4" rx="1.7" fill="${g}"/>`;
      case 'waiting':
        return `<circle cx="${L}" cy="${cy + 1.2}" r="4.4" fill="${g}"/><circle cx="${R}" cy="${cy + 1.2}" r="4.4" fill="${g}"/>
                <path d="M${L - 6},${cy - 6} L${L + 4},${cy - 8.2}" ${S} stroke-width="1.9"/><path d="M${R + 6},${cy - 6} L${R - 4},${cy - 8.2}" ${S} stroke-width="1.9"/>`;
      case 'idle':
        return `<path d="M${L - 5},${cy - 1} q5,5.5 10,0" ${S} stroke-width="2.6"/><path d="M${R - 5},${cy - 1} q5,5.5 10,0" ${S} stroke-width="2.6"/>`;
      case 'done':
        return `<path d="M${L - 5},${cy + 2.2} q5,-6.4 10,0" ${S} stroke-width="2.6"/><path d="M${R - 5},${cy + 2.2} q5,-6.4 10,0" ${S} stroke-width="2.6"/>`;
      case 'error':
        return `<path d="M${L - 3.5},${cy - 3.5} L${L + 3.5},${cy + 3.5} M${L + 3.5},${cy - 3.5} L${L - 3.5},${cy + 3.5}" ${S} stroke-width="2.4"/>
                <path d="M${R - 3.5},${cy - 3.5} L${R + 3.5},${cy + 3.5} M${R + 3.5},${cy - 3.5} L${R - 3.5},${cy + 3.5}" ${S} stroke-width="2.4"/>`;
      default:
        return '';
    }
  }

  function avatarSvg(l, st, size) {
    const b = BODY[l.body] || BODY.slim;
    const bc = l.color;
    const eg = st === 'idle' ? '#5B6982' : bc;
    const uid = `${l.id}${st}${Math.round(size)}`;
    const dim = st === 'idle' ? 0.55 : 1;
    const tilt = st === 'idle' ? -6 : st === 'waiting' ? 4 : 0;
    const rg = RING[st] || bc;
    const rw = st === 'waiting' ? 2.8 : 1.5;
    const ro = st === 'waiting' ? 0.65 : st === 'error' ? 0.5 : 0.28;
    const ring =
      st === 'working' || st === 'waiting' || st === 'error'
        ? `<path d="${b.d}" fill="none" stroke="${rg}" stroke-width="${rw}" opacity="${ro}"
             transform="translate(50,${b.top + 28}) scale(1.14) translate(-50,-${b.top + 28})"
             class="${st === 'waiting' ? 'pulse' : ''}"/>`
        : '';
    const zzz =
      st === 'idle'
        ? `<text x="78" y="30" font-size="12" fill="${bc}" opacity=".6" font-family="sans-serif">z</text>
           <text x="87" y="20" font-size="8.5" fill="${bc}" opacity=".38" font-family="sans-serif">z</text>`
        : '';

    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="overflow:visible;display:block">
      <defs><filter id="f${uid}" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <g opacity="${dim}" transform="rotate(${tilt} 50 60)">${ring}${deco(l, bc, st)}
        <path d="${b.d}" fill="#1A2135" stroke="${bc}" stroke-width="2.2"/>${visorOf(l, b.ey)}
        <g filter="url(#f${uid})" opacity=".7">${eyesOf(b.ey, eg, st, l.visor === 'slit')}</g>
        ${eyesOf(b.ey, eg, st, l.visor === 'slit')}${markOf(l, bc, b.ch)}${zzz}</g></svg>`;
  }

  window.avatarSvg = avatarSvg;
})();
