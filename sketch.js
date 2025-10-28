// 割合大富豪 — 高品質 完全版（無限周回対応）
// paste into p5.js Web Editor as sketch.js

// -------- 設定 --------
const ROUNDS_TOTAL = 3;
const HAND_SIZE = 5;
const POINTS_BY_PLACE = [100,80,50,30];

const CANVAS_W = 1100, CANVAS_H = 700;
const CARD_W = 120, CARD_H = 160;

const SPEED_NORMAL = 1000;
const SPEED_FAST = 300;

// -------- グローバル状態 --------
let state = "home"; // home | rules | playing | roundResult | tournamentResult
let roundNumber = 0;
let tournamentScores = [0,0,0,0];
let cycles = 0; // サイクル（3ラウンドを1サイクルとする）
let infiniteLoop = true; // 無限周回モード

let deck = [];
let hands = [[],[],[],[]]; // 0=you(bottom),1=AI top,2=AI right,3=AI left

let pile = []; // {card, owner}
let lastPlayedValue = null;
let lastPlayedBy = -1;
let finished = [false,false,false,false];
let finishOrder = [];
let consecutivePasses = 0;

let currentTurn = 0;
let moving = null; // {card,owner,x,y,targetX,targetY}
let waitingForNext = false;
let infoMsg = "";
let passFlags = [0,0,0,0]; // millis timestamps for PASS visual

// UI elements
let startBtn, rulesBtn, passBtn, nextRoundBtn, homeBtn, speedToggleBtn, soundToggleBtn, infiniteToggleBtn;

// audio + effects
let audioCtx = null;
let showSound = true;
let aiDelay = SPEED_NORMAL;
let confetti = [];
let playLog = [];

// -------- helpers: audio/effects/log --------
function ensureAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function playBeep(freq=440, time=0.08, gain=0.12){
  if(!showSound) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  ensureAudioCtx();
  o.type='sine'; o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + time);
}
function playWin(){
  if(!showSound) return;
  ensureAudioCtx();
  const now = audioCtx.currentTime;
  const g = audioCtx.createGain(); g.gain.value = 0.08; g.connect(audioCtx.destination);
  const o1 = audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value=880; o1.connect(g); o1.start(now); o1.stop(now+0.12);
  const o2 = audioCtx.createOscillator(); o2.type='sine'; o2.frequency.value=660; o2.connect(g); o2.start(now+0.08); o2.stop(now+0.26);
}

function spawnConfetti(x,y,amount=24){
  for(let i=0;i<amount;i++){
    confetti.push({
      x,y,
      vx: random(-4,4),
      vy: random(-6,-1),
      life: random(60,140),
      col: color(random(200,255), random(120,255), random(60,255))
    });
  }
}
function updateConfetti(){
  for(let i=confetti.length-1;i>=0;i--){
    const p = confetti[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--;
    if(p.life<=0) confetti.splice(i,1);
  }
}

function pushLog(msg){
  const ts = nf(floor((millis()/1000)%60),2);
  playLog.unshift(`[${ts}s] ${msg}`);
  if(playLog.length>8) playLog.pop();
}

// -------- setup / draw --------
function setup(){
  createCanvas(CANVAS_W, CANVAS_H);
  textFont('serif'); rectMode(CORNER); textAlign(CENTER, CENTER);
  createUI();
  showHome();
}

function draw(){
  backgroundGradient();
  updateConfetti();

  if(state === "home") drawHomeScreen();
  else if(state === "rules") drawRulesScreen();
  else if(state === "playing"){
    drawTable(); drawHUD(); drawPlayLog();
    if(moving){
      moving.x = lerp(moving.x, moving.targetX, 0.14);
      moving.y = lerp(moving.y, moving.targetY, 0.14);
      drawCardFloating(moving.x, moving.y, moving.card);
      if(dist(moving.x, moving.y, moving.targetX, moving.targetY) < 6){
        const mv = moving; moving = null; commitMove(mv);
      }
    }
    drawPassLabels();
  }
  else if(state === "roundResult") { drawTable(); drawHUD(); drawRoundResultOverlay(); }
  else if(state === "tournamentResult") drawTournamentResult();

  // confetti on top
  noStroke();
  for(const p of confetti) { fill(p.col); ellipse(p.x, p.y, 8, 6); }
}

// -------- UI 作成 --------
function createUI(){
  startBtn = createButton('トーナメント開始'); startBtn.size(220,64); startBtn.style('font-size','20px');
  startBtn.mousePressed(()=> { if(state==='home') startTournament(); });

  rulesBtn = createButton('ルール'); rulesBtn.size(180,48); rulesBtn.style('font-size','16px');
  rulesBtn.mousePressed(()=> { showRules(); });

  passBtn = createButton('パス'); passBtn.size(120,46); passBtn.style('font-size','18px');
  passBtn.mousePressed(()=> onPlayerPass()); passBtn.hide();

  nextRoundBtn = createButton('次のラウンドへ'); nextRoundBtn.size(180,48); nextRoundBtn.style('font-size','18px');
  // nextRound の挙動はここで汎用にまとめる
  nextRoundBtn.mousePressed(()=> {
    if(roundNumber < ROUNDS_TOTAL) startRound(roundNumber+1);
    else {
      if(infiniteLoop){
        cycles++; pushLog(`サイクル ${cycles} 完了 — 続行`);
        startRound(1);
      } else {
        drawTournamentResult(); nextRoundBtn.hide(); homeBtn.show();
      }
    }
  });

  nextRoundBtn.hide();

  homeBtn = createButton('ホームへ戻る'); homeBtn.size(160,40); homeBtn.style('font-size','16px');
  homeBtn.mousePressed(()=> showHome()); homeBtn.hide();

  speedToggleBtn = createButton('AI速度: 通常'); speedToggleBtn.size(140,36); speedToggleBtn.style('font-size','14px');
  speedToggleBtn.mousePressed(()=> {
    if(aiDelay === SPEED_NORMAL){ aiDelay = SPEED_FAST; speedToggleBtn.html('AI速度: 高速'); pushLog('AI高速モード'); }
    else { aiDelay = SPEED_NORMAL; speedToggleBtn.html('AI速度: 通常'); pushLog('AI通常モード'); }
  });
  speedToggleBtn.hide();

  soundToggleBtn = createButton('音: ON'); soundToggleBtn.size(90,36); soundToggleBtn.style('font-size','14px');
  soundToggleBtn.mousePressed(()=> { showSound = !showSound; soundToggleBtn.html(showSound? '音: ON' : '音: OFF'); pushLog('サウンド ' + (showSound? 'ON':'OFF')); });
  soundToggleBtn.hide();

  infiniteToggleBtn = createButton('無限周回: ON'); infiniteToggleBtn.size(150,36); infiniteToggleBtn.style('font-size','14px');
  infiniteToggleBtn.mousePressed(()=> {
    infiniteLoop = !infiniteLoop;
    infiniteToggleBtn.html(infiniteLoop? '無限周回: ON' : '無限周回: OFF');
    pushLog('無限周回 ' + (infiniteLoop? 'ON':'OFF'));
  });
  infiniteToggleBtn.hide();
}

// -------- ホーム / ルール 表示 --------
function showHome(){
  state = "home";
  roundNumber = 0; tournamentScores = [0,0,0,0]; cycles = 0;
  startBtn.show(); rulesBtn.show();
  passBtn.hide(); nextRoundBtn.hide(); homeBtn.hide();
  speedToggleBtn.hide(); soundToggleBtn.hide(); infiniteToggleBtn.hide();
  startBtn.position(width/2 - 110, height/2 - 60);
  rulesBtn.position(width/2 - 90, height/2 + 20);
  infoMsg = '3ラウンド合計で競う割合大富豪。無限周回モードあり。';
  playLog = [];
}

function showRules(){
  state = "rules";
  startBtn.hide(); rulesBtn.hide(); passBtn.hide(); nextRoundBtn.hide();
  speedToggleBtn.hide(); soundToggleBtn.hide(); infiniteToggleBtn.hide();
  homeBtn.show(); homeBtn.position(width/2 - 80, height - 80);
}

function drawHomeScreen(){
  push();
  fill(255); textSize(48); textStyle(BOLD);
  text('割合大富豪 — 3ラウンドトーナメント', width/2, height/3 - 40);
  textStyle(NORMAL); fill(240); textSize(16);
  text('1位:100pt / 2位:80pt / 3位:50pt / 4位:30pt', width/2, height/3 + 0);
  textSize(14);
}
function drawRulesScreen(){
  background(12,80,40);
  push(); fill(255); textSize(28); text('ルール', width/2, 60); textAlign(LEFT, TOP);
  textSize(16);
  const txt =
`ルール説明

・目的：
  みんなでカードを出しあって、先に手札をなくした人が上の順位になります。
  3回戦して、合計の点で勝負します。

・カードの見方：
  カードには「300人の30%」「200円の四割引き」などが書いてあります。
  書かれている計算をして、その答えを比べます（たとえば300の30% = 90）。

・出せるカード：
  「いま場に出ている数」より大きい数を出してください。
  場が空の時は何でも出せます。

・パスの使い方（左下）：
  出せないときは、画面の左下にある「パス」ボタンを押します。
  （ここで押すとすぐに次の人に順番が移ります）

・場が流れる（リセット）：
  みんなが順番にパスしたら、場は空になります。
  そのときは、最後にカードを出した人からまた始めます。

・得点：
  1位：100点、2位：80点、3位：50点、4位：30点。
  3回戦の合計で勝敗を決めます。`;

  text(txt, 60, 100, width - 120, height - 220);
  // 図でパス位置を示す
  push();
  translate(60, height - 160);
  fill(240); rect(0, 0, 420, 120, 8);
  fill(0); textSize(14); textAlign(LEFT, TOP);
  text('図：パスの位置（実際は画面左下にあります）', 10, 6);
  push();
  translate(10,36);
  noFill(); stroke(200); rect(0,0,220,64,6);
  fill(80); textSize(12); textAlign(CENTER, CENTER); text('ゲーム画面（例）', 110, 18);
  fill(255,220,0); rect(6, 34, 80, 28, 6);
  fill(0); textSize(12); text('パス', 46, 48);
  pop();
  pop();
  pop();
}

// -------- トーナメント / ラウンド --------
function startTournament(){
  tournamentScores = [0,0,0,0]; cycles = 0; // スコアは保持するか毎回リセットするかはここで決定
  startRound(1);
}
function startRound(n){
  state = "playing"; roundNumber = n; resetRoundState();
  deck = generateDeck(120); shuffle(deck, true);
  for(let p=0;p<4;p++) hands[p] = [];
  for(let i=0;i<HAND_SIZE;i++){
    for(let p=0;p<4;p++) hands[p].push(deck.pop());
  }
  for(let p=0;p<4;p++) shuffle(hands[p], true);
  currentTurn = 0;
  infoMsg = `ラウンド ${roundNumber} 開始 — あなたから`;
  showPlayingButtons();
  pushLog(`ラウンド${roundNumber}開始`);
}

function resetRoundState(){
  pile = []; lastPlayedValue = null; lastPlayedBy = -1;
  finished = [false,false,false,false]; finishOrder = [];
  consecutivePasses = 0; moving = null; waitingForNext = false; infoMsg='';
  passFlags = [0,0,0,0]; playLog = []; confetti = [];
}

// -------- デッキ生成 --------
function generateDeck(minCount){
  const bases = [50,60,75,80,90,100,120,150,180,200,250,300,360,400,450,500,600,700,800,900,1000,1200,1500];
  const rates = [5,10,12.5,15,20,25,30,33.3,40,45,50,60,66.7,70,75,80,90];
  const deck = []; let id=1;
  while(deck.length < minCount){
    const base = random(bases);
    const t = random(['percent','waribiki','fraction','half']);
    let text='', value=NaN;
    if(t==='percent'){
      const p = random(rates);
      const ptext = (Math.round(p*10)/10).toString().replace('.0','');
      text = `${base}の${ptext}%`; value = round2(base * (p/100));
    } else if(t==='waribiki'){
      const p = floor(random(1,9));
      const kanji = ['零','一','二','三','四','五','六','七','八','九','十'];
      const ptext = (random() < 0.6) ? kanji[p] : String(p);
      text = `${base}円の${ptext}割引き`; value = round2(base * (1 - p/10));
    } else if(t==='fraction'){
      const fr = random([[1,2],[1,3],[2,3],[1,4],[3,4]]);
      text = `${base}の${fr[0]}/${fr[1]}`; value = round2(base * (fr[0]/fr[1]));
    } else {
      text = `${base}円の半額`; value = round2(base * 0.5);
    }
    if(Number.isFinite(value)) deck.push({id:id++, text:text, value:value});
  }
  return deck;
}
function round2(x){ return Math.round(x*100)/100; }

// -------- 表示: テーブル / HUD / カード --------
function backgroundGradient(){
  for(let y=0;y<height;y++){
    let t = map(y,0,height,0,1);
    const c = lerpColor(color(24,94,24), color(6,50,12), t);
    stroke(c); line(0,y,width,y);
  }
}

function drawTable(){
  drawAIBack(1); drawAIBack(3); drawAIBack(2);
  drawPile(); drawPlayerHand(); drawAvatars();
}

function drawHUD(){
  push();
  fill(255); textSize(18); textAlign(CENTER, CENTER);
  text(`ラウンド ${roundNumber}/${ROUNDS_TOTAL}  サイクル ${cycles}`, width/2, 28);
  textSize(14);
  text(`ターン: ${nameOf(currentTurn)}    場の値: ${lastPlayedValue === null ? '-' : lastPlayedValue}`, width/2, 52);
  // score box
  textAlign(LEFT, TOP); fill(255); textSize(14);
  const sx=20, sy=90;
  text('スコア', sx, sy);
  for(let p=0;p<4;p++) text(`${nameOf(p)}: ${tournamentScores[p]} pt`, sx, sy + 20 + p*18);
  textAlign(CENTER); textSize(14); text(infoMsg, width/2, height - 20);
  pop();
  if(state === "playing" && currentTurn === 0 && !moving) passBtn.show(); else passBtn.hide();
  highlightCurrentPlayerArea();
}
function drawPile(){
  const sx = width/2 - CARD_W/2, sy = height/2 - CARD_H/2;
  push(); fill(245); stroke(0); rect(sx,sy,CARD_W,CARD_H,12);
  if(pile.length>0){ const top = pile[pile.length-1].card; drawCardAt(sx,sy,top,false,true); }
  else { fill(0); noStroke(); textSize(12); text('場は空', width/2, height/2); }
  pop();
}

function drawPlayerHand(){
  const hand = hands[0]; const total = hand.length;
  const gap = 20;
  const totalW = total*CARD_W + Math.max(0,(total-1))*gap;
  const startX = width/2 - totalW/2; const y = height - CARD_H - 40;
  for(let i=0;i<total;i++){
    const x = startX + i*(CARD_W+gap); const card = hand[i];
    drawCardAt(x,y,card,false,true,false);
    if(mouseX >= x && mouseX <= x+CARD_W && mouseY >= y && mouseY <= y+CARD_H){
      drawTooltip(x+CARD_W/2, y-18, `${card.text} = ${card.value}`);
    }
  }
}

function drawAIBack(owner){
  const hand = hands[owner];
  if(owner === 1){
    const total = hand.length; const gap=18;
    const totalW = total*CARD_W + Math.max(0,(total-1))*gap;
    const startX = width/2 - totalW/2; const y = 12;
    for(let i=0;i<total;i++){
      const x = startX + i*(CARD_W+gap);
      drawCardBackSimple(x,y);
      if(mouseX >= x && mouseX <= x+CARD_W && mouseY >= y && mouseY <= y+CARD_H) drawTooltip(x+CARD_W/2, y+CARD_H+12, `残り ${hand.length} 枚`);
    }
  } else if(owner === 2){
    const total = hand.length;
    for(let i=0;i<total;i++){
      const x = width - CARD_W - 12; const y = 110 + i*(CARD_H/3);
      drawCardBackSimple(x,y);
      if(mouseX >= x && mouseX <= x+CARD_W && mouseY >= y && mouseY <= y+CARD_H) drawTooltip(x-CARD_W/2,y+CARD_H/2, `残り ${hand.length} 枚`);
    }
  } else {
    const total = hand.length;
    for(let i=0;i<total;i++){
      const x = 12; const y = 110 + i*(CARD_H/3);
      drawCardBackSimple(x,y);
      if(mouseX >= x && mouseX <= x+CARD_W && mouseY >= y && mouseY <= y+CARD_H) drawTooltip(x+CARD_W*1.5,y+CARD_H/2, `残り ${hand.length} 枚`);
    }
  }
}

function drawCardBackSimple(x,y){
  push(); translate(x,y);
  noStroke(); fill(0,0,0,60); rect(6,8,CARD_W,CARD_H,12);
  stroke(30); fill(245); rect(0,0,CARD_W,CARD_H,12);
  noStroke(); fill(60); textSize(12); textAlign(CENTER, CENTER); text('★', CARD_W/2, CARD_H/2);
  pop();
}

// 縦書きで表示（最大12文字）
function drawCardAt(x,y,card,hidden=false,fancy=false,highlight=false){
  push(); translate(x,y);
  noStroke(); fill(0,0,0,60); rect(6,8,CARD_W,CARD_H,12);
  stroke(30); fill(255);
  if(highlight){ strokeWeight(3); stroke(255,200,0); } else strokeWeight(1);
  rect(0,0,CARD_W,CARD_H,12);
  strokeWeight(1);
  if(!hidden && card){
    fill((Math.round(card.value)%2===0)?'#b71c1c':'#111');
    textSize(14); textAlign(CENTER, TOP);
    let chars = Array.from(card.text);
    let disp = chars.slice(0,12);
    for(let i=0;i<disp.length;i++) text(disp[i], CARD_W/2, 12 + i*16);
    fill(90); textAlign(RIGHT, BOTTOM); text(String(card.value), CARD_W - 8, CARD_H - 8);
  }
  pop();
}
function drawCardFloating(cx, cy, card){
  const x = cx - CARD_W/2, y = cy - CARD_H/2;
  drawCardAt(x,y,card,false,true,false);
}

function drawTooltip(cx, cy, txt){
  push();
  textSize(14); textAlign(CENTER, CENTER);
  fill(40,220); rectMode(CENTER);
  rect(cx, cy - 6, textWidth(txt) + 20, 28, 6);
  fill(255); noStroke();
  text(txt, cx, cy - 6);
  pop();
}

function drawAvatars(){
  push();
  drawAvatar(width/2, 8, 1);
  drawAvatar(width - 20, height/2, 2);
  drawAvatar(20, height/2, 3);
  drawAvatar(width/2, height - 8, 0);
  pop();
}
function drawAvatar(cx, cy, owner){
  push(); translate(cx, cy);
  const sz = 44; fill(80); stroke(0); ellipse(0,0,sz,sz);
  fill(255); noStroke(); textSize(12); text(nameOf(owner), 0, 0);
  pop();
}



// -------- プレイログ表示 --------
function drawPlayLog(){
  const x = width - 360, y = height - 180;
  push();
  fill(0,0,0,120); rect(x-10, y-10, 340, 160, 8);
  fill(255); textSize(12); textAlign(LEFT, TOP);
  for(let i=0;i<playLog.length;i++) text(playLog[i], x, y + i*18);
  pop();
}

// -------- PASS ラベル --------
function drawPassLabels(){
  const now = millis();
  for(let p=0;p<4;p++){
    const t = passFlags[p];
    if(t && now - t < 1200){
      push(); textSize(18); fill(255,200,0); stroke(0); strokeWeight(0.6);
      if(p===0) text('PASS', width/2, height - CARD_H - 80);
      else if(p===1) text('PASS', width/2, 12 + CARD_H + 20);
      else if(p===2) text('PASS', width - CARD_W - 40, height/2 - 20);
      else text('PASS', 40, height/2 - 20);
      pop();
    }
  }
}

// -------- 入出力（クリック） --------
function mousePressed(){
  if(state !== "playing") return;
  if(currentTurn === 0 && !moving){
    // pass area left-bottom
    if(mouseX >= 20 && mouseX <= 140 && mouseY >= height - 70 && mouseY <= height - 24){
      onPlayerPass(); return;
    }
    // click player's cards
    const hand = hands[0]; const total = hand.length; if(total === 0) return;
    const gap = 20; const totalW = total*CARD_W + Math.max(0,(total-1))*gap;
    const startX = width/2 - totalW/2; const y = height - CARD_H - 40;
    for(let i=0;i<total;i++){
      const x = startX + i*(CARD_W+gap);
      if(mouseX >= x && mouseX <= x+CARD_W && mouseY >= y && mouseY <= y+CARD_H){
        const card = hand[i];
        if(!card) return;
        if(lastPlayedValue === null || card.value > lastPlayedValue){
          playCardAnimated(0, i, x + CARD_W/2, y + CARD_H/2);
          playBeep(880, 0.06, 0.06);
          pushLog(`あなたが ${card.text} (${card.value}) を出した`);
        } else {
          infoMsg = 'そのカードは場の値を超えていません';
          playBeep(180, 0.08, 0.08);
        }
        return;
      }
    }
  }
}

// -------- パス処理 --------
function onPlayerPass(){
  if(state !== "playing" || currentTurn !== 0 || moving) return;
  consecutivePasses++;
  passFlags[0] = millis();
  infoMsg = 'あなたはパスしました';
  pushLog('あなたがパス');
  playBeep(220, 0.06, 0.06);
  if(checkRoundReset()) return;
  scheduleNextTurn(aiDelay);
}

// -------- カード出し（アニメ） --------
function playCardAnimated(owner, index, originX, originY){
  if(owner<0 || owner>3) return;
  const arr = hands[owner];
  if(!arr || index < 0 || index >= arr.length) return;
  const cardObj = arr.splice(index,1)[0];
  if(!cardObj) return;
  moving = { card: cardObj, owner: owner, x: originX, y: originY, targetX: width/2, targetY: height/2 };
  infoMsg = `${nameOf(owner)} がカードを出します...`;
}

function commitMove(mv){
  pile.push({card: mv.card, owner: mv.owner});
  lastPlayedValue = mv.card.value;
  lastPlayedBy = mv.owner;
  consecutivePasses = 0;
  passFlags[mv.owner] = 0;
  infoMsg = `${nameOf(mv.owner)} が ${mv.card.text} = ${mv.card.value} を出しました`;
  pushLog(`${nameOf(mv.owner)}: ${mv.card.text} (${mv.card.value})`);
  playBeep(560, 0.06, 0.06);
  if(!finished[mv.owner] && hands[mv.owner].length === 0){
    finished[mv.owner] = true; finishOrder.push(mv.owner);
    if(finishOrder.length === 1){ spawnConfetti(width/2, height/2 - 40, 36); playWin(); }
  }
  const active = countActivePlayers();
  if(finishOrder.length === 4 || active <= 1){
    for(let i=0;i<4;i++) if(!finished[i]){ finished[i]=true; finishOrder.push(i); }
    setTimeout(()=> endRound(), 700); return;
  }
  scheduleNextTurn(aiDelay);
}

// -------- ターン進行 --------
function scheduleNextTurn(delay){
  if(waitingForNext) return;
  waitingForNext = true;
  setTimeout(()=> { waitingForNext = false; proceedToNextActiveTurn(); }, delay);
}

function proceedToNextActiveTurn(){
  const next = getNextIndex(currentTurn);
  if(next === null){ endRound(); return; }
  currentTurn = next;
  if(currentTurn === 0) { infoMsg = 'あなたのターンです'; }
  else { setTimeout(()=> aiAct(currentTurn), 220); }
}

function getNextIndex(from){
  for(let step=1; step<=4; step++){
    const idx = (from + step) % 4;
    if(!finished[idx]) return idx;
  }
  return null;
}

// -------- AI ロジック（改善） --------
function aiAct(owner){
  if(state !== "playing" || moving) return;
  const hand = hands[owner];
  if(!hand || hand.length === 0){
    if(!finished[owner]){ finished[owner] = true; finishOrder.push(owner); }
    passFlags[owner] = millis(); consecutivePasses++;
    infoMsg = `${nameOf(owner)} は手札がありません（パス）`;
    pushLog(`${nameOf(owner)} がパス（手札無し）`);
    playBeep(200 + owner*40, 0.06, 0.05);
    if(checkRoundReset()) return;
    scheduleNextTurn(aiDelay);
    return;
  }
  const playable = hand.map((c,i)=>({c,idx:i})).filter(o => lastPlayedValue===null || o.c.value > lastPlayedValue);
  if(playable.length === 0){
    passFlags[owner] = millis(); consecutivePasses++;
    infoMsg = `${nameOf(owner)} は出せるカードがなくパスしました`;
    pushLog(`${nameOf(owner)} がパス`);
    playBeep(200 + owner*40, 0.06, 0.05);
    if(checkRoundReset()) return;
    scheduleNextTurn(aiDelay);
    return;
  }
  // strategy
  let chooseIdx = playable[0].idx;
  if(hand.length <= 2){
    let best = playable.reduce((a,b)=> a.c.value >= b.c.value ? a : b);
    chooseIdx = best.idx;
  } else {
    let best = playable.reduce((a,b)=> a.c.value <= b.c.value ? a : b);
    chooseIdx = best.idx;
    if(random() < 0.12){ let alt = playable.reduce((a,b)=> a.c.value >= b.c.value ? a : b); chooseIdx = alt.idx; }
  }
  const pos = getAICardPos(owner, chooseIdx, hand.length);
  const card = hand[chooseIdx];
  playCardAnimated(owner, chooseIdx, pos.x, pos.y);
  pushLog(`${nameOf(owner)} が ${card.text} を出した`);
  playBeep(520 + owner*40, 0.06, 0.06);
}

// -------- AI 位置計算 --------
function getAICardPos(owner, idx, total){
  if(owner === 1){
    const gap=18; const totalW = total*CARD_W + Math.max(0,(total-1))*gap;
    const startX = width/2 - totalW/2; const x = startX + idx*(CARD_W+gap) + CARD_W/2;
    const y = 12 + CARD_H/2; return {x,y};
  } else if(owner === 2){
    const x = width - CARD_W/2 - 12; const y = 110 + idx*(CARD_H/3) + CARD_H/2; return {x,y};
  } else {
    const x = CARD_W/2 + 12; const y = 110 + idx*(CARD_H/3) + CARD_H/2; return {x,y};
  }
}

// -------- ラウンド終了判定・処理 --------
function countActivePlayers(){ let n=0; for(let i=0;i<4;i++) if(!finished[i]) n++; return n; }

function checkRoundReset(){
  let active = countActivePlayers();
  if(active <= 1) return false;
  if(consecutivePasses >= (active - 1) && lastPlayedBy !== -1){
    infoMsg = '全員がパス — 場を流します';
    pushLog('場が流れました');
    pile = []; lastPlayedValue = null; consecutivePasses = 0;
    let starter = lastPlayedBy;
    if(finished[starter]) starter = getNextIndex(starter-1) ?? 0;
    currentTurn = starter;
    if(currentTurn !== 0) scheduleNextTurn(aiDelay); else infoMsg += '（あなたから再開）';
    return true;
  }
  return false;
}

function endRound(){
  for(let i=0;i<4;i++) if(!finished[i]){ finished[i]=true; finishOrder.push(i); }
  for(let i=0;i<4;i++){ const owner = finishOrder[i]; tournamentScores[owner] += (POINTS_BY_PLACE[i] || 0); }
  state = "roundResult"; infoMsg = `ラウンド ${roundNumber} 終了`; showRoundResultButtons();

  if(roundNumber >= ROUNDS_TOTAL){
    if(infiniteLoop){
      // 無限周回モード：一旦結果表示を短く出してから次サイクル開始
      pushLog(`サイクル ${cycles+1} 終了。継続します...`);
      // 表示は roundResult でされるが自動で次サイクル開始する。
      setTimeout(()=>{
        cycles++;
        startRound(1);
      }, 1400);
    } else {
      nextRoundBtn.html('最終結果を見る');
      // nextRoundBtn の動作は createUI で設定済み
    }
  }
}

// -------- 結果描画 --------
function drawRoundResultOverlay(){
  push(); fill(0,0,0,200); rect(0,0,width,height);
  fill(255); textSize(28); textAlign(CENTER, CENTER); text(`ラウンド ${roundNumber} 結果`, width/2, 90);
  textSize(18);
  const startY = 150;
  for(let i=0;i<finishOrder.length;i++){
    const owner = finishOrder[i];
    let col = color(220); if(i===0) col = color(255,215,0); else if(i===1) col = color(192,192,192); else if(i===2) col = color(205,127,50);
    fill(col); rect(width/2 - 320, startY + i*44 - 18, 640, 36, 8);
    fill(0); textSize(16); text(`${i+1}位: ${nameOf(owner)}   ${POINTS_BY_PLACE[i]} pt   累計 ${tournamentScores[owner]} pt`, width/2, startY + i*44);
  }
  textSize(14); fill(255);
  if(infiniteLoop) text('無限周回モード: 続行します。ホームに戻ると停止します。', width/2, startY + 220);
  else text('「次のラウンドへ」または「ホームへ戻る」を選んでください。', width/2, startY + 220);
  pop();
}

function drawTournamentResult(){
  state = "tournamentResult"; hideAllButtons(); homeBtn.show();
  push(); fill(0,0,0,200); rect(0,0,width,height);
  fill(255); textSize(34); textAlign(CENTER, CENTER); text('トーナメント最終結果', width/2, 80);
  let arr = [0,1,2,3].map(i=>({id:i,score:tournamentScores[i]}));
  arr.sort((a,b)=>b.score - a.score);
  textSize(20);
  const baseY = 150;
  for(let i=0;i<arr.length;i++){ const r = arr[i]; text(`${i+1}位: ${nameOf(r.id)} — ${r.score} pt`, width/2, baseY + i*44); }
  textSize(14); text('ホームに戻って再度プレイできます。', width/2, baseY + arr.length*44 + 30);
  pop();
  spawnConfetti(width/2, 140, 40);
  playWin();
}

// -------- ヘルパー --------
function nameOf(i){ return i===0 ? 'あなた' : `AI${i}`; }
function round2(x){ return Math.round(x*100)/100; }
function shuffle(arr, mutate=true){ if(!arr) return arr; if(!mutate) arr = arr.slice(); for(let i=arr.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

// -------- UI 表示ユーティリティ --------
function showPlayingButtons(){
  startBtn.hide(); rulesBtn.hide(); passBtn.show(); nextRoundBtn.hide(); homeBtn.hide();
  speedToggleBtn.show(); soundToggleBtn.show(); infiniteToggleBtn.show();
  speedToggleBtn.position(20, 20); soundToggleBtn.position(170,20); infiniteToggleBtn.position(320,20);
}

function showRoundResultButtons(){
  passBtn.hide(); nextRoundBtn.show(); homeBtn.show();
  nextRoundBtn.position(width/2 - 90, height/2 + 160); homeBtn.position(width/2 - 80, height/2 + 220);
}

function hideAllButtons(){ startBtn.hide(); rulesBtn.hide(); passBtn.hide(); nextRoundBtn.hide(); homeBtn.hide(); speedToggleBtn.hide(); soundToggleBtn.hide(); infiniteToggleBtn.hide(); }

// -------- play log / hud display --------
// (playLog の表示関数は上で定義済み - 重複防止のためそのまま)

// -------- highlight current player area --------
function highlightCurrentPlayerArea(){
  push();
  noFill(); stroke(255,230,120); strokeWeight(3);
  if(currentTurn === 0){
    const total = hands[0].length; const gap = 20;
    const totalW = total*CARD_W + Math.max(0,(total-1))*gap;
    const startX = width/2 - totalW/2; const y = height - CARD_H - 40;
    if(total>0) rect(startX-8, y-8, totalW+16, CARD_H+16, 12); else rect(width/2 - CARD_W/2 - 8, y-8, CARD_W+16, CARD_H+16, 12);
  } else if(currentTurn === 1){
    const total = hands[1].length; const gap=18;
    const totalW = total*CARD_W + Math.max(0,(total-1))*gap; const startX = width/2 - totalW/2; const y = 12;
    if(total>0) rect(startX-8, y-8, totalW+16, CARD_H+16, 12);
  } else if(currentTurn === 2){
    const x = width - CARD_W - 12; const total = hands[2].length; const heightBox = Math.max(CARD_H, total*(CARD_H/3)+16);
    rect(x-8, 100-8, CARD_W+16, heightBox+16, 12);
  } else {
    const x = 12; const total = hands[3].length; const heightBox = Math.max(CARD_H, total*(CARD_H/3)+16);
    rect(x-8, 100-8, CARD_W+16, heightBox+16, 12);
  }
  pop();
}

// -------- keyboard --------
function keyPressed(){ if(key==='R' || key==='r') showHome(); }

// ========= end of file =========
