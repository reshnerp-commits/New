// Iron Conflict - RTS Game
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

let gameRunning = false, lastTime = 0, selectedUnits = [], buildMode = null, buildType = null;
let resources = { metal: 500, oil: 200, income: { metal: 10, oil: 0 } };
let units = [], buildings = [], projectiles = [], particles = [], oilWells = [], score = 0;

const UNIT_TYPES = {
    scout: { name: 'Scout', cost: { metal: 50, oil: 0 }, hp: 80, damage: 10, speed: 3, range: 100, attackSpeed: 1000, size: 15, symbol: '🏃' },
    tank: { name: 'Tank', cost: { metal: 100, oil: 25 }, hp: 200, damage: 30, speed: 1.5, range: 150, attackSpeed: 1500, size: 25, symbol: '🚜' },
    artillery: { name: 'Artillery', cost: { metal: 150, oil: 50 }, hp: 120, damage: 60, speed: 1, range: 400, attackSpeed: 3000, size: 22, symbol: '🎯' },
    'anti-air': { name: 'AA Gun', cost: { metal: 120, oil: 30 }, hp: 150, damage: 25, speed: 1.2, range: 250, attackSpeed: 800, size: 20, symbol: '🔫' }
};

const BUILDING_TYPES = {
    factory: { name: 'Factory', cost: { metal: 200, oil: 100 }, hp: 500, size: 60, symbol: '🏭' },
    refinery: { name: 'Refinery', cost: { metal: 150, oil: 0 }, hp: 300, size: 50, symbol: '⛽', oilIncome: 5 },
    turret: { name: 'Turret', cost: { metal: 100, oil: 50 }, hp: 400, damage: 20, range: 200, attackSpeed: 1000, size: 40, symbol: '🗼' },
    wall: { name: 'Wall', cost: { metal: 25, oil: 0 }, hp: 300, size: 30, symbol: '🧱' }
};

class GameObject { constructor(x, y, team) { this.x = x; this.y = y; this.team = team; this.selected = false; this.dead = false; } }

class Unit extends GameObject {
    constructor(x, y, type, team) {
        super(x, y, team); this.type = type; const s = UNIT_TYPES[type];
        this.maxHp = s.hp; this.hp = s.hp; this.damage = s.damage; this.speed = s.speed;
        this.range = s.range; this.attackSpeed = s.attackSpeed; this.size = s.size; this.symbol = s.symbol;
        this.targetPos = null; this.targetUnit = null; this.targetBuilding = null; this.lastAttack = 0;
    }
    update(now) {
        if (this.dead) return;
        if (this.targetPos && !this.targetUnit && !this.targetBuilding) {
            const dx = this.targetPos.x - this.x, dy = this.targetPos.y - this.y, dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 5) this.targetPos = null; else { this.x += (dx/dist)*this.speed; this.y += (dy/dist)*this.speed; }
        }
        if (now - this.lastAttack > this.attackSpeed) {
            const target = this.findTarget();
            if (target) { const dist = Math.hypot(target.x-this.x, target.y-this.y); if (dist <= this.range) this.attack(target, now); else if (!this.targetPos) this.targetPos = {x:target.x, y:target.y}; }
        }
    }
    findTarget() {
        if (this.targetUnit && !this.targetUnit.dead) return this.targetUnit;
        if (this.targetBuilding && !this.targetBuilding.dead) return this.targetBuilding;
        let nearest = null, nearestDist = Infinity;
        units.forEach(u => { if (u.team !== this.team && !u.dead) { const d = Math.hypot(u.x-this.x, u.y-this.y); if (d < nearestDist && d < this.range*2) { nearest = u; nearestDist = d; } } });
        if (nearest) return nearest;
        buildings.forEach(b => { if (b.team !== this.team && !b.dead) { const d = Math.hypot(b.x-this.x, b.y-this.y); if (d < nearestDist && d < this.range*2) { nearest = b; nearestDist = d; } } });
        return nearest;
    }
    attack(target, now) { this.lastAttack = now; projectiles.push({ x:this.x, y:this.y, targetX:target.x, targetY:target.y, target, damage:this.damage, team:this.team, speed:8 }); }
    draw(ctx) {
        if (this.dead) return;
        ctx.fillStyle = this.team === 'player' ? '#4A90D9' : '#D94A4A';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill();
        ctx.font = `${this.size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(this.symbol, this.x, this.y);
        if (this.selected) { ctx.strokeStyle = '#0F0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, this.size+5, 0, Math.PI*2); ctx.stroke(); }
        const hpPct = this.hp/this.maxHp;
        ctx.fillStyle = '#F00'; ctx.fillRect(this.x-15, this.y-this.size-10, 30, 4);
        ctx.fillStyle = '#0F0'; ctx.fillRect(this.x-15, this.y-this.size-10, 30*hpPct, 4);
    }
    takeDamage(amt) { this.hp -= amt; if (this.hp <= 0) { this.dead = true; createExplosion(this.x, this.y); if (this.team === 'enemy') addScore(100); } }
}

class Building extends GameObject {
    constructor(x, y, type, team) {
        super(x, y, team); this.type = type; const s = BUILDING_TYPES[type];
        this.maxHp = s.hp; this.hp = s.hp; this.size = s.size; this.symbol = s.symbol;
        this.damage = s.damage || 0; this.range = s.range || 0; this.attackSpeed = s.attackSpeed || 0;
        this.lastAttack = 0; this.productionTimer = 0;
    }
    update(now) {
        if (this.dead) return;
        if (this.damage > 0 && now - this.lastAttack > this.attackSpeed) { let t = this.findTarget(); if (t && Math.hypot(t.x-this.x, t.y-this.y) <= this.range) this.attack(t, now); }
        if (this.type === 'factory' && this.team === 'player') { this.productionTimer += 16; if (this.productionTimer > 5000) { this.productionTimer = 0; resources.metal += 5; } }
        if (this.type === 'refinery' && this.team === 'player') { this.productionTimer += 16; if (this.productionTimer > 1000) { this.productionTimer = 0; resources.oil += BUILDING_TYPES.refinery.oilIncome; } }
    }
    findTarget() { let nearest = null, nearestDist = Infinity; units.forEach(u => { if (u.team !== this.team && !u.dead) { const d = Math.hypot(u.x-this.x, u.y-this.y); if (d < nearestDist && d < (this.range||200)*2) { nearest = u; nearestDist = d; } } }); return nearest; }
    attack(target, now) { this.lastAttack = now; projectiles.push({ x:this.x, y:this.y, targetX:target.x, targetY:target.y, target, damage:this.damage, team:this.team, speed:6 }); }
    draw(ctx) {
        if (this.dead) return;
        ctx.fillStyle = this.team === 'player' ? '#5D90D9' : '#D95D5D';
        ctx.fillRect(this.x-this.size/2, this.y-this.size/2, this.size, this.size);
        ctx.font = `${this.size/1.5}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(this.symbol, this.x, this.y);
        if (this.selected) { ctx.strokeStyle = '#0F0'; ctx.lineWidth = 2; ctx.strokeRect(this.x-this.size/2-3, this.y-this.size/2-3, this.size+6, this.size+6); }
        const hpPct = this.hp/this.maxHp;
        ctx.fillStyle = '#F00'; ctx.fillRect(this.x-20, this.y-this.size/2-10, 40, 5);
        ctx.fillStyle = '#0F0'; ctx.fillRect(this.x-20, this.y-this.size/2-10, 40*hpPct, 5);
    }
    takeDamage(amt) { this.hp -= amt; if (this.hp <= 0) { this.dead = true; createExplosion(this.x, this.y); if (this.team === 'enemy') addScore(500); } }
}

class Particle { constructor(x, y) { this.x = x; this.y = y; this.vx = (Math.random()-0.5)*5; this.vy = (Math.random()-0.5)*5; this.life = 1; this.decay = 0.02+Math.random()*0.03; } update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay; } draw(ctx) { ctx.globalAlpha = this.life; ctx.fillStyle = '#FA0'; ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1; } }
function createExplosion(x, y) { for (let i = 0; i < 15; i++) particles.push(new Particle(x, y)); }

function initGame() {
    resizeCanvas();
    buildings.push(new Building(200, 300, 'factory', 'player'), new Building(150, 400, 'refinery', 'player'), new Building(1200, 300, 'factory', 'enemy'), new Building(1250, 400, 'turret', 'enemy'));
    units.push(new Unit(250, 350, 'scout', 'player'), new Unit(280, 350, 'tank', 'player'), new Unit(1150, 350, 'scout', 'enemy'), new Unit(1120, 350, 'tank', 'enemy'));
    oilWells.push({ x: 600, y: 200, captured: false, team: null }, { x: 800, y: 500, captured: false, team: null });
    setInterval(() => { if (gameRunning) { resources.metal += resources.income.metal; resources.oil += resources.income.oil; updateUI(); } }, 1000);
    setInterval(enemyAI, 3000);
}

function enemyAI() {
    if (!gameRunning) return;
    const enemyBuildings = buildings.filter(b => b.team === 'enemy' && !b.dead); if (enemyBuildings.length === 0) return;
    const factory = enemyBuildings.find(b => b.type === 'factory');
    if (factory && Math.random() < 0.4) { const types = ['scout', 'tank', 'artillery']; units.push(new Unit(factory.x+80, factory.y, types[Math.floor(Math.random()*types.length)], 'enemy')); }
    const enemyUnits = units.filter(u => u.team === 'enemy' && !u.dead), playerBuildings = buildings.filter(b => b.team === 'player' && !b.dead);
    if (playerBuildings.length > 0 && enemyUnits.length > 0) { const target = playerBuildings[Math.floor(Math.random()*playerBuildings.length)]; enemyUnits.forEach(u => { if (!u.targetBuilding) u.targetBuilding = target; }); }
}

function updateUI() { document.getElementById('metal-display').textContent = `Metal: ${resources.metal}`; document.getElementById('oil-display').textContent = `Oil: ${resources.oil}`; document.getElementById('population-display').textContent = `Units: ${units.filter(u => u.team === 'player' && !u.dead).length}/50`; }
function addScore(pts) { score += pts; document.getElementById('score-display').textContent = `Score: ${score}`; }
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight - 180; minimapCanvas.width = 200; minimapCanvas.height = 150; }

function draw() {
    ctx.fillStyle = '#2d5016'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y = 0; y < canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    oilWells.forEach(w => { ctx.fillStyle = w.captured ? (w.team === 'player' ? '#4A90D9' : '#D94A4A') : '#F90'; ctx.beginPath(); ctx.arc(w.x, w.y, 20, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#000'; ctx.font = '20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🛢️', w.x, w.y); });
    buildings.forEach(b => b.draw(ctx)); units.forEach(u => u.draw(ctx));
    projectiles.forEach(p => { ctx.fillStyle = p.team === 'player' ? '#FF0' : '#F60'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill(); });
    particles.forEach(p => p.draw(ctx)); drawMinimap();
}

function drawMinimap() { minimapCtx.fillStyle = '#2d5016'; minimapCtx.fillRect(0, 0, 200, 150); const sx = 200/1500, sy = 150/800; buildings.forEach(b => { minimapCtx.fillStyle = b.team === 'player' ? '#4A90D9' : '#D94A4A'; minimapCtx.fillRect(b.x*sx, b.y*sy, 8, 8); }); units.forEach(u => { minimapCtx.fillStyle = u.team === 'player' ? '#4A90D9' : '#D94A4A'; minimapCtx.fillRect(u.x*sx, u.y*sy, 4, 4); }); }

function update(deltaTime, now) {
    units.forEach(u => u.update(now)); buildings.forEach(b => b.update(now));
    projectiles.forEach((p, i) => { const dx = p.targetX - p.x, dy = p.targetY - p.y, dist = Math.sqrt(dx*dx + dy*dy); if (dist < 10 || (p.target && p.target.dead)) { if (p.target && !p.target.dead) p.target.takeDamage(p.damage); projectiles.splice(i, 1); } else { p.x += (dx/dist)*p.speed; p.y += (dy/dist)*p.speed; } });
    particles.forEach((p, i) => { p.update(); if (p.life <= 0) particles.splice(i, 1); });
    units = units.filter(u => !u.dead); buildings = buildings.filter(b => !b.dead); checkGameEnd();
}

function checkGameEnd() { const playerB = buildings.filter(b => b.team === 'player' && !b.dead), enemyB = buildings.filter(b => b.team === 'enemy' && !b.dead); if (enemyB.length === 0) gameOver(true); else if (playerB.length === 0) gameOver(false); }
function gameOver(victory) { gameRunning = false; document.getElementById('game-over-title').textContent = victory ? '🎉 Victory!' : '💀 Defeat!'; document.getElementById('game-over-message').textContent = victory ? 'You destroyed all enemy bases!' : 'Your base has been destroyed!'; document.getElementById('game-over').classList.remove('hidden'); }
function gameLoop(ts) { if (!gameRunning) return; const dt = ts - lastTime; lastTime = ts; update(dt, ts); draw(); requestAnimationFrame(gameLoop); }

let isDragging = false, dragStart = {x:0,y:0}, dragBox = null;
canvas.addEventListener('mousedown', e => { if (e.button === 0) { isDragging = true; dragStart = {x:e.clientX, y:e.clientY}; let clicked = false; units.forEach(u => { if (u.team === 'player' && !u.dead && Math.hypot(u.x-e.clientX, u.y-e.clientY) < u.size) { clicked = true; if (!e.ctrlKey && !e.shiftKey) units.forEach(x => x.selected = false); u.selected = true; } }); if (!clicked && !e.ctrlKey && !e.shiftKey) units.forEach(u => u.selected = false); } });
canvas.addEventListener('mousemove', e => { if (isDragging) dragBox = { x: Math.min(dragStart.x,e.clientX), y: Math.min(dragStart.y,e.clientY), width: Math.abs(e.clientX-dragStart.x), height: Math.abs(e.clientY-dragStart.y) }; });
canvas.addEventListener('mouseup', e => { if (isDragging && dragBox) { units.forEach(u => { if (u.team === 'player' && !u.dead && u.x >= dragBox.x && u.x <= dragBox.x+dragBox.width && u.y >= dragBox.y && u.y <= dragBox.y+dragBox.height) u.selected = true; }); } isDragging = false; dragBox = null; });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (buildMode) { placeBuilding(e.clientX, e.clientY); return; } const selected = units.filter(u => u.selected); if (selected.length > 0) { let found = false; units.forEach(u => { if (u.team === 'enemy' && !u.dead && Math.hypot(u.x-e.clientX, u.y-e.clientY) < u.size) { selected.forEach(s => { s.targetUnit = u; s.targetBuilding = null; s.targetPos = null; }); found = true; } }); buildings.forEach(b => { if (b.team === 'enemy' && !b.dead && Math.hypot(b.x-e.clientX, b.y-e.clientY) < b.size) { selected.forEach(s => { s.targetBuilding = b; s.targetUnit = null; s.targetPos = null; }); found = true; } }); if (!found) selected.forEach(s => { s.targetPos = {x:e.clientX, y:e.clientY}; s.targetUnit = null; s.targetBuilding = null; }); } });

document.querySelectorAll('.building-btn').forEach(btn => { btn.addEventListener('click', () => { const type = btn.dataset.building, cost = BUILDING_TYPES[type].cost; if (resources.metal >= cost.metal && resources.oil >= cost.oil) { buildMode = true; buildType = type; document.getElementById('build-overlay').classList.remove('hidden'); document.getElementById('build-name').textContent = BUILDING_TYPES[type].name; document.getElementById('build-cost').textContent = `⚡${cost.metal} 🛢️${cost.oil}`; } }); });
function placeBuilding(x, y) { if (!buildMode || !buildType) return; const cost = BUILDING_TYPES[buildType].cost; resources.metal -= cost.metal; resources.oil -= cost.oil; buildings.push(new Building(x, y, buildType, 'player')); buildMode = false; buildType = null; document.getElementById('build-overlay').classList.add('hidden'); updateUI(); }
document.querySelectorAll('.unit-btn').forEach(btn => { btn.addEventListener('click', () => { const type = btn.dataset.unit, cost = UNIT_TYPES[type].cost; if (resources.metal >= cost.metal && resources.oil >= cost.oil) { const factory = buildings.find(b => b.type === 'factory' && b.team === 'player' && !b.dead); if (factory) { resources.metal -= cost.metal; resources.oil -= cost.oil; units.push(new Unit(factory.x+50, factory.y, type, 'player')); updateUI(); } } }); });
document.getElementById('cancel-build').addEventListener('click', () => { buildMode = false; buildType = null; document.getElementById('build-overlay').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { buildMode = false; buildType = null; document.getElementById('build-overlay').classList.add('hidden'); } });
document.getElementById('start-game-btn').addEventListener('click', () => { document.getElementById('start-screen').classList.add('hidden'); gameRunning = true; lastTime = performance.now(); initGame(); requestAnimationFrame(gameLoop); });
document.getElementById('restart-btn').addEventListener('click', () => { document.getElementById('game-over').classList.add('hidden'); units = []; buildings = []; projectiles = []; particles = []; resources = { metal: 500, oil: 200, income: { metal: 10, oil: 0 } }; score = 0; gameRunning = true; lastTime = performance.now(); initGame(); requestAnimationFrame(gameLoop); });
window.addEventListener('resize', resizeCanvas);
updateUI();
