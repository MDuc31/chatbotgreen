/* ===================== Helpers ===================== */
function normalize(str){
  return (str||"").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function escapeHtml(str){ return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ===================== Data & State ===================== */
let KB_ROWS=[], KB_ROWS_TEXT=[], KB_COLUMNS=[];
const STATE = {
  mode: "idle",              // 'idle' | 'await_env_for_target' | 'await_env_generic'
  pendingTarget: null,       // tên cây người dùng muốn trồng
  lastEnv: null              // lưu thông số đã nhập gần nhất
};

/* ===================== Boot ===================== */
document.addEventListener("DOMContentLoaded", async () => {
  const sendBtn = document.getElementById("send-btn");
  const input   = document.getElementById("chatbot-input");
  const msgs    = document.getElementById("chatbot-messages");

  sendBtn.addEventListener("click", onSend);
  input.addEventListener("keypress", e => { if (e.key === "Enter") onSend(); });

  // submit của form nhập 6 thông số (event delegation)
  msgs.addEventListener("submit", (e) => {
    if (e.target && e.target.id === "env-form") {
      e.preventDefault();
      const env = readEnvFromForm(e.target);
      STATE.lastEnv = env;

      if (STATE.mode === "await_env_for_target" && STATE.pendingTarget) {
        handleEnvForTarget(env, STATE.pendingTarget);
      } else {
        handleEnvGeneric(env);
      }
    }
  });

  // chào & hướng dẫn
  appendMessage("bot",
    "Xin chào, tôi tên <b>Green</b> và tôi là chatbot cây trồng của bạn. Bạn cần tôi tư vấn gì?<br>" +
    "• Gõ: <i>Tôi muốn trồng cây: xoài</i><br>" +
    "• Hoặc: <i>Tôi muốn trồng cây</i>"
  );

  try{
    await loadExcel("bang_de_xuat_cay_trong.xlsx");
  }catch(e){
    console.error(e);
    appendMessage("bot","⚠️ Không thể nạp file Excel. Hãy chắc chắn file nằm cùng thư mục.");
  }
});

/* ===================== Core I/O ===================== */
function appendMessage(sender, html){
  const wrap = document.getElementById("chatbot-messages");
  const el = document.createElement("div");
  el.className = `message ${sender}`;
  el.innerHTML = html.replace(/\n/g,"<br>").replace(/  /g,"&nbsp;&nbsp;");
  wrap.appendChild(el);
  wrap.parentElement.scrollTop = wrap.parentElement.scrollHeight;
}

// Chèn node (dùng cho form để tránh lỗi hiển thị chuỗi)
function appendMessageNode(sender, node){
  const wrap = document.getElementById("chatbot-messages");
  const container = document.createElement("div");
  container.className = `message ${sender}`;
  container.style.width = "100%";
  container.style.maxWidth = "100%";
  container.appendChild(node);
  wrap.appendChild(container);
  wrap.parentElement.scrollTop = wrap.parentElement.scrollHeight;
}

function onSend(){
  const input = document.getElementById("chatbot-input");
  const text = input.value.trim();
  if(!text) return;
  appendMessage("user", escapeHtml(text));
  input.value = "";
  routeInput(text);
}

async function loadExcel(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error("fetch excel failed");
  const ab = await res.arrayBuffer();
  const wb = XLSX.read(ab, { type:"array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });

  KB_ROWS = rows;
  KB_COLUMNS = rows.length ? Object.keys(rows[0]) : [];
  KB_ROWS_TEXT = rows.map(row=>{
    const parts=[]; for(const k in row){ const v=row[k]; if(v!=="" && v!=null) parts.push(String(v)); }
    return normalize(parts.join(" | "));
  });
}

function routeInput(text){
  const n = normalize(text);

  // --- KỊCH BẢN 2: người dùng chỉ nói "tôi muốn trồng cây"
  //   (đặt TRƯỚC để không bị kịch bản 1 nuốt mất)
  if (/\btoi\s*muon\s*trong\s*cay\b|\bmuon\s*trong\s*cay\b/.test(n)) {
    STATE.mode = "await_env_generic";
    STATE.pendingTarget = null;
    showEnvForm("Được thôi, hãy cho tôi dữ liệu đất về nơi bạn định trồng nhé:");
    return;
  }

  // --- KỊCH BẢN 1: có tên cây
  // bắt rõ: "tôi muốn trồng cây: <tên>"
  let m = n.match(/toi\s*muon\s*trong\s*cay\s*:\s*([a-z0-9\s\-]+)/);
  if (!m) m = n.match(/muon\s*trong\s*cay\s*:\s*([a-z0-9\s\-]+)/);
  // hoặc "tôi muốn trồng <tên>" nhưng KHÔNG cho <tên> = "cay"
  if (!m) m = n.match(/toi\s*muon\s*trong\s+(?!cay\b)([a-z0-9\s\-]+)/);
  if (!m) m = n.match(/muon\s*trong\s+(?!cay\b)([a-z0-9\s\-]+)/);

  if (m) {
    const targetName = (m[1] || "").trim();
    const row = findCropByName(targetName);
    if (!row) { appendMessage("bot", `Không có dữ liệu về cây <b>${escapeHtml(targetName)}</b>.`); return; }
    STATE.mode = "await_env_for_target";
    STATE.pendingTarget = targetName;
    showEnvForm(`Được thôi, hãy cho tôi dữ liệu đất về nơi bạn định trồng <b>${escapeHtml(targetName)}</b> nhé:`);
    return;
  }

  // --- Còn lại: tra cứu từ khóa trong Excel
  appendMessage("bot", answerFromExcel(text));
}


/* ===================== Form 6 thông số (DOM) ===================== */
function showEnvForm(prefixText){
  const wrapper = document.createElement("div");

  const lead = document.createElement("div");
  lead.innerHTML = prefixText;
  wrapper.appendChild(lead);

  const form = document.createElement("form");
  form.id = "env-form"; form.className = "env-form";

  const grid = document.createElement("div");
  grid.className = "env-grid";

  // tạo một ô label + input
  function addItem(labelText, name, ph, type="text"){
    const item = document.createElement("div"); item.className = "env-item";
    const label = document.createElement("label"); label.textContent = labelText;
    const input = document.createElement("input");
    input.name = name; input.type = type; input.placeholder = ph;
    if(type==="number") input.step="0.1";
    item.append(label, input); grid.appendChild(item);
  }

  // hàng 1
  addItem("N (mg/kg hoặc Thấp/TB/Cao)", "N",   "vd: 60 hoặc TB");
  addItem("P (mg/kg hoặc Thấp/TB/Cao)", "P",   "vd: 40 hoặc Thấp");
  addItem("K (mg/kg hoặc Thấp/TB/Cao)", "K",   "vd: 70 hoặc Cao");
  // hàng 2
  addItem("Temp - Nhiệt độ (°C)",       "T",   "vd: 28", "number");
  addItem("Humi - Độ ẩm (%)",           "HUM", "vd: 60 hoặc TB");
  addItem("pH",                          "pH",  "vd: 6.2", "number");

  const actions = document.createElement("div");
  actions.className = "env-actions";
  const btnClear = document.createElement("button"); btnClear.type="reset";  btnClear.className="env-btn clear";  btnClear.textContent="Xoá";
  const btnApply = document.createElement("button"); btnApply.type="submit"; btnApply.className="env-btn apply"; btnApply.textContent="Áp dụng";
  actions.append(btnClear, btnApply);

  form.append(grid, actions);
  wrapper.appendChild(form);

  appendMessageNode("bot", wrapper);
}

function readEnvFromForm(form){
  const v = Object.fromEntries(new FormData(form).entries());
  return {
    N: numOrNull(v.N), P: numOrNull(v.P), K: numOrNull(v.K),
    pH: numOrNull(v.pH), T: numOrNull(v.T), HUM: numOrNull(v.HUM),
    N_level: levelFromText(v.N), P_level: levelFromText(v.P),
    K_level: levelFromText(v.K), HUM_level: levelFromText(v.HUM),
    target: STATE.pendingTarget || null
  };
}
function numOrNull(s){ if(s==null) return null; const n=Number(String(s).replace(',','.').trim()); return Number.isFinite(n)?n:null; }
function levelFromText(s){
  if(!s) return null; const t=normalize(s).replace(/\s+/g,'');
  if(t.startsWith("thap")) return "Thấp";
  if(t==="tb" || t.startsWith("trungbinh")) return "TB";
  if(t.startsWith("cao")) return "Cao";
  return null;
}

/* ===================== Excel-only search ===================== */
function answerFromExcel(query){
  if(!KB_ROWS.length) return "Chưa có dữ liệu (chưa nạp được Excel).";
  const q = normalize(query);
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = KB_ROWS_TEXT.map((text, idx)=>{
    let score=0;
    for(const t of tokens){ if(t.length>=2 && new RegExp("\\b"+t+"\\b").test(text)) score++; }
    return { idx, score };
  });
  const hits = scored.filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
  if(!hits.length) return "Không tìm thấy thông tin phù hợp trong bảng.";

  let out = `<div><b>Top ${hits.length} kết quả từ Excel:</b></div>`;
  for(const h of hits){ out += cardForRow(KB_ROWS[h.idx], `Điểm khớp: ${h.score}`); }
  out += `<div style="opacity:.6;font-size:12px;">(Câu trả lời chỉ dựa trên dữ liệu trong Excel.)</div>`;
  return out;
}

function findCropByName(name){
  const n = normalize(name);
  for(const r of KB_ROWS){
    const names = [r["Cây trồng"], r["Cay trong"], r["Tên"], r["Ten"]].filter(Boolean).map(String);
    if(names.some(x=>normalize(x).includes(n))) return r;
  }
  return null;
}

/* ===================== Scoring & Gợi ý điều chỉnh ===================== */
const LEVEL_THRESH = {
  N:{low:50, high:100}, P:{low:25, high:50}, K:{low:50, high:100},
  HUM_PERCENT:{low:40, high:70},
};
function valueToLevel(val, kind){ if(val==null) return null; const th=LEVEL_THRESH[kind]; if(!th) return null; if(val<th.low) return "Thấp"; if(val>th.high) return "Cao"; return "TB"; }
function parseRange(text){ const s=normalize(text||""); const m=s.match(/([0-9]+(\.[0-9]+)?)\s*[-–—]\s*([0-9]+(\.[0-9]+)?)/); if(!m) return null; return {min:Number(m[1]), max:Number(m[3])}; }
function containsWord(s, w){ return new RegExp("\\b"+normalize(w)+"\\b").test(normalize(s||"")); }
function sameLevel(a,b){ const A=normalize(a).replace(/\s+/g,''); const B=normalize(b).replace(/\s+/g,''); if(A==="tb") return (B==="tb"||B==="trungbinh"); if(A==="trungbinh") return (B==="tb"||B==="trungbinh"); return A===B; }

function scoreCrop(row, env){
  let score=0;
  const phRange = parseRange(row["pH tối ưu"] || row["pH toi uu"] || row["pH"]);
  if(phRange && env.pH!=null && env.pH>=phRange.min && env.pH<=phRange.max) score+=2;

  const tRange = parseRange(row["Nhiệt độ tối ưu (°C)"] || row["Nhiet do toi uu (°C)"] || row["Nhiệt độ"]);
  if(tRange && env.T!=null && env.T>=tRange.min && env.T<=tRange.max) score+=1;

  const humPref = String(row["Độ ẩm đất ưa thích"] || "");
  let humLevelRow=null;
  if(containsWord(humPref,"thap")) humLevelRow="Thấp";
  else if(containsWord(humPref,"trung")||containsWord(humPref,"tb")) humLevelRow="TB";
  else if(containsWord(humPref,"cao")||containsWord(humPref,"am")) humLevelRow="Cao";
  const humLevelEnv = env.HUM_level || valueToLevel(env.HUM,"HUM_PERCENT");
  if(humLevelRow && humLevelEnv && humLevelRow===humLevelEnv) score+=1;

  const needN=(row["N cầu"]||row["N cau"]||"").trim();
  const needP=(row["P cầu"]||row["P cau"]||"").trim();
  const needK=(row["K cầu"]||row["K cau"]||"").trim();
  const haveN=env.N_level||valueToLevel(env.N,"N");
  const haveP=env.P_level||valueToLevel(env.P,"P");
  const haveK=env.K_level||valueToLevel(env.K,"K");
  if(needN && haveN && sameLevel(needN,haveN)) score+=1;
  if(needP && haveP && sameLevel(needP,haveP)) score+=1;
  if(needK && haveK && sameLevel(needK,haveK)) score+=1;

  return { score };
}
function rankCropsByEnvironment(env){
  const scored = KB_ROWS.map((row,idx)=>({ idx, row, score: scoreCrop(row,env).score }));
  return scored.sort((a,b)=>b.score-a.score).slice(0,3);
}

function suggestAmendments(targetRow, env){
  const adv=[];

  // pH
  const phRange = parseRange(targetRow["pH tối ưu"] || targetRow["pH toi uu"] || targetRow["pH"]);
  if(phRange && env.pH!=null){
    if(env.pH < phRange.min) adv.push(`pH hiện ${env.pH} thấp hơn chuẩn ${phRange.min}–${phRange.max}. ➜ Bón vôi (dolomite), tăng hữu cơ ủ hoai.`);
    else if(env.pH > phRange.max) adv.push(`pH hiện ${env.pH} cao hơn chuẩn ${phRange.min}–${phRange.max}. ➜ Bổ sung lưu huỳnh/SA, tăng hữu cơ chua, tránh bón vôi.`);
  }

  // Nhiệt độ
  const tRange = parseRange(targetRow["Nhiệt độ tối ưu (°C)"] || targetRow["Nhiet do toi uu (°C)"]);
  if(tRange && env.T!=null){
    if(env.T < tRange.min) adv.push(`Nhiệt độ ${env.T}°C thấp hơn ${tRange.min}–${tRange.max}°C ➜ Chọn thời vụ ấm hơn/che ấm.`);
    else if(env.T > tRange.max) adv.push(`Nhiệt độ ${env.T}°C cao hơn ${tRange.min}–${tRange.max}°C ➜ Che mát, tưới làm mát.`);
  }

  // Ẩm độ
  const humPref = String(targetRow["Độ ẩm đất ưa thích"] || "");
  let humNeed="TB";
  if(containsWord(humPref,"thap")) humNeed="Thấp";
  else if(containsWord(humPref,"cao")||containsWord(humPref,"am")) humNeed="Cao";
  const curHum = env.HUM_level || valueToLevel(env.HUM,"HUM_PERCENT");
  if(curHum && humNeed && curHum!==humNeed){
    if(humNeed==="Cao") adv.push(`Độ ẩm: cây ưa ẩm hơn ➜ tăng tưới (nhỏ giọt/phun mưa), phủ rơm, hạn chế thoát nước.`);
    if(humNeed==="Thấp") adv.push(`Độ ẩm: cây ưa khô ráo ➜ cải tạo thoát nước, lên luống cao, giảm tưới.`);
  }

  // NPK
  const needN=(targetRow["N cầu"]||targetRow["N cau"]||"").trim();
  const needP=(targetRow["P cầu"]||targetRow["P cau"]||"").trim();
  const needK=(targetRow["K cầu"]||targetRow["K cau"]||"").trim();
  const haveN=env.N_level||valueToLevel(env.N,"N");
  const haveP=env.P_level||valueToLevel(env.P,"P");
  const haveK=env.K_level||valueToLevel(env.K,"K");
  function gap(have,need,label,up,down){
    if(!have||!need) return;
    const H=normalize(have).replace(/\s+/g,''), R=normalize(need).replace(/\s+/g,'');
    const eq=x=>x==="tb"||x==="trungbinh"?["tb","trungbinh"]:[x];
    if(!eq(R).includes(H)){
      if(H==="thap" || (H==="tb" && R==="cao")) adv.push(`${label}: hiện ${have} < nhu cầu ${need} ➜ Bổ sung ${up}.`);
      else adv.push(`${label}: hiện ${have} > nhu cầu ${need} ➜ ${down}.`);
    }
  }
  gap(haveN,needN,"Đạm (N)","đạm Urea/SA","giảm đạm");
  gap(haveP,needP,"Lân (P)","DAP/Super lân","giảm lân");
  gap(haveK,needK,"Kali (K)","KCl/K2SO4","giảm kali");

  if(!adv.length) adv.push("Điều kiện hiện tại đã khá phù hợp; duy trì bón cân đối và theo dõi thực địa.");
  return adv;
}

/* ===================== Xử lý 2 kịch bản ===================== */
function handleEnvForTarget(env, targetName){
  const row = findCropByName(targetName);
  if(!row){ appendMessage("bot", `Không có dữ liệu về cây <b>${escapeHtml(targetName)}</b>.`); return; }

  let html = `<div><b>Khuyến nghị theo môi trường bạn nhập:</b></div>`;
  html += envSummary(env);

  const ranked = rankCropsByEnvironment(env);
  if(ranked.length){
    html += `<div><b>Đề xuất trồng:</b></div>`;
    html += cardForRow(ranked[0].row, `Điểm phù hợp: ${ranked[0].score}`);
  }

  const adv = suggestAmendments(row, env);
  html += `<div style="margin-top:8px;"><b>Nếu muốn trồng "${escapeHtml(targetName)}":</b></div>`;
  html += `<ul style="margin:6px 0 0 18px;">${adv.map(a=>`<li>${escapeHtml(a)}</li>`).join("")}</ul>`;

  if(ranked.length>1){
    html += `<div style="margin-top:12px;"><b>Lựa chọn khác:</b></div>`;
    for(let i=1;i<ranked.length;i++){
      html += cardForRow(ranked[i].row, `Điểm phù hợp: ${ranked[i].score}`);
    }
  }
  appendMessage("bot", html);
  STATE.mode = "idle"; STATE.pendingTarget = null;
}

function handleEnvGeneric(env){
  const ranked = rankCropsByEnvironment(env);
  let html = `<div><b>Khuyến nghị theo môi trường bạn nhập:</b></div>`;
  html += envSummary(env);

  if(!ranked.length){ html += "Không tìm thấy cây phù hợp."; appendMessage("bot", html); return; }

  html += `<div><b>Đề xuất trồng:</b></div>`;
  html += cardForRow(ranked[0].row, `Điểm phù hợp: ${ranked[0].score}`);
  if(ranked.length>1){
    html += `<div style="margin-top:12px;"><b>Lựa chọn khác:</b></div>`;
    for(let i=1;i<ranked.length;i++){
      html += cardForRow(ranked[i].row, `Điểm phù hợp: ${ranked[i].score}`);
    }
  }
  html += `<div style="opacity:.7;font-size:12px;margin-top:8px;">Muốn trồng cây cụ thể? Gõ: <i>Tôi muốn trồng [tên cây]</i>. Tôi sẽ dùng bộ thông số trên để tư vấn điều chỉnh.</div>`;
  appendMessage("bot", html);
  STATE.mode = "idle";
}

function envSummary(env){
  return `<div style="opacity:.8;font-size:13px;margin:6px 0 10px;">
    N=${env.N ?? env.N_level ?? "?"}, 
    P=${env.P ?? env.P_level ?? "?"}, 
    K=${env.K ?? env.K_level ?? "?"}, 
    pH=${env.pH ?? "?"}, 
    T=${env.T ?? "?"}°C, 
    Ẩm=${env.HUM ?? env.HUM_level ?? "?"}
  </div>`;
}

/* ===================== UI helpers ===================== */
function cardForRow(row, subtitle){
  const title = row["Cây trồng"] || row["Cay trong"] || row["Tên"] || row["Ten"] || "(Không tên)";
  let html = `<div style="margin:10px 0;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">`;
  if(subtitle) html += `<div style="opacity:.7;font-size:12px;margin-bottom:6px;">${escapeHtml(subtitle)}</div>`;
  html += `<ul style="padding-left:18px;margin:0;">`;
  for(const col of KB_COLUMNS){
    const val = row[col];
    if(val!==null && val!==undefined && String(val)!==""){
      if(String(col).toLowerCase().includes("cay") || String(col).toLowerCase().includes("trong"))
        html += `<li><b>${escapeHtml(col)}:</b> <b>${escapeHtml(String(val))}</b></li>`;
      else
        html += `<li><b>${escapeHtml(col)}:</b> ${escapeHtml(String(val))}</li>`;
    }
  }
  html += `</ul></div>`;
  return html;
}

