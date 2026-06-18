import { useState, useEffect } from "react";

const BRL = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v) => parseFloat(v) || 0;

// Formata segundos como "1 min 20 s" ou "45 s"
const formatSec = (s) => {
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60), sec = total % 60;
  return sec > 0 ? `${m} min ${sec} s` : `${m} min`;
};

const STORAGE_KEY = "cnc_config_v7";
const QUOTES_KEY  = "cnc_quotes_v4";

// Chapa padrão
const CHAPA_ALTURA  = 2730; // mm
const CHAPA_LARGURA = 1830; // mm
const CHAPA_AREA    = (CHAPA_ALTURA / 1000) * (CHAPA_LARGURA / 1000); // m²
const ESPACO_ENTRE  = 7; // mm

const MATERIAIS_BRANCOS = [
  { id: "mdf_branco_6",  label: "MDF Branco TX 6mm",  espessura: "6"  },
  { id: "mdf_branco_15", label: "MDF Branco TX 15mm", espessura: "15" },
  { id: "mdf_branco_18", label: "MDF Branco TX 18mm", espessura: "18" },
];
const MATERIAIS_COLORIDOS = [
  { id: "mdf_colorido_6",  label: "MDF Colorido 6mm",  espessura: "6"  },
  { id: "mdf_colorido_15", label: "MDF Colorido 15mm", espessura: "15" },
  { id: "mdf_colorido_18", label: "MDF Colorido 18mm", espessura: "18" },
];
const TODOS_MATERIAIS = [...MATERIAIS_BRANCOS, ...MATERIAIS_COLORIDOS];

// Tempos de referência por geometria
// refArea em mm², progS = segundos de programação, maqS = segundos de máquina
// para a dimensão de referência informada
const GEOMETRIAS = [
  { id:"quadrado",     label:"Quadrado",        icon:"◼", campos:["lado"],
    refL:500, refA:500, progS:32,  maqS:16  },
  { id:"retangulo",    label:"Retângulo",        icon:"▬", campos:["largura","altura"],
    refL:500, refA:600, progS:38,  maqS:29  },
  { id:"circulo",      label:"Círculo",          icon:"●", campos:["diametro"],
    refL:500, refA:500, progS:39,  maqS:20  },
  { id:"oval",         label:"Oval",             icon:"⬮", campos:["largura","altura"],
    refL:500, refA:600, progS:32,  maqS:21  },
  { id:"poligono",     label:"Polígono",         icon:"⬡", campos:["largura","altura","lados"],
    refL:500, refA:500, progS:28,  maqS:78  },
  { id:"especiais",    label:"Especiais",        icon:"✦", campos:["largura","altura"], extra:"+25% projeto",
    refL:900, refA:2000, progS:300, maqS:2820 },
  { id:"muxarabi_50",  label:"Muxarabi 50×30",  icon:"⊠", campos:["largura","altura"], muxarabi:true,
    refL:1000, refA:1000, progS:110, maqS:1200 },
  { id:"muxarabi_70",  label:"Muxarabi 70×30",  icon:"⊞", campos:["largura","altura"], muxarabi:true,
    refL:1000, refA:1000, progS:80,  maqS:960  },
  { id:"muxarabi_100", label:"Muxarabi 100×30", icon:"⊟", campos:["largura","altura"], muxarabi:true,
    refL:1000, refA:1000, progS:67,  maqS:660  },
];

const defaultConfig = {
  valorHoraOperador: "",
  valorHoraMaquina: "",
  potenciaSpindle: "",
  potenciaExtras: "",
  tarifaEnergia: "",
  custoManutencaoHora: "",
  margem: "",
  materialBranco: Object.fromEntries(MATERIAIS_BRANCOS.map(m => [m.id, { valorM2: "", valorChapa: "" }])),
};

// ── helpers ───────────────────────────────────────────────────────────────────
function getDimensoes(item) {
  // returns { largura, altura } in mm
  if (item.geometria === "quadrado")  return { largura: num(item.lado), altura: num(item.lado) };
  if (item.geometria === "circulo")   return { largura: num(item.diametro), altura: num(item.diametro) };
  return { largura: num(item.largura), altura: num(item.altura) };
}

function calcAreaItem(item) {
  const { largura, altura } = getDimensoes(item);
  return ((largura + ESPACO_ENTRE) / 1000) * ((altura + ESPACO_ENTRE) / 1000);
}

function calcAreaTotal(itens) {
  return itens.reduce((sum, it) => sum + calcAreaItem(it) * num(it.quantidade), 0);
}

function calcChapas(areaTotal) {
  if (areaTotal <= 0) return 0;
  return Math.ceil(areaTotal / CHAPA_AREA);
}

// Cálculo proporcional por área: tempoReal = tempoRef × (areaReal / areaRef)
function calcTempos(item) {
  const geo = GEOMETRIAS.find(g => g.id === item.geometria);
  if (!geo) return { progH: 0, maqH: 0 };
  const { largura, altura } = getDimensoes(item);
  const qtd = num(item.quantidade);
  if (!largura || !altura || !qtd) return { progH: 0, maqH: 0 };

  const areaReal = (largura / 1000) * (altura / 1000);        // m²
  const areaRef  = (geo.refL / 1000) * (geo.refA / 1000);     // m² de referência
  const fator    = areaRef > 0 ? areaReal / areaRef : 1;

  const fatorEspecial = item.ferramenta === "especial" ? 1.5 : 1;
  const progS = geo.progS * fator * qtd * fatorEspecial;
  const maqS  = geo.maqS  * fator * qtd * fatorEspecial;

  return { progH: progS / 3600, maqH: maqS / 3600 };
}

function calcTempoProjetoHoras(item)      { return calcTempos(item).progH; }
function calcTempoUsinagemHoras(item)     { return calcTempos(item).maqH; }

function calcCustoMaterial(form, config) {
  if (form.donoDaMaterial === "cliente") return 0;
  const areaTotal = calcAreaTotal(form.itens);
  const chapas    = calcChapas(areaTotal);
  const mat = form.tipoMaterial;
  const isColorido = MATERIAIS_COLORIDOS.some(m => m.id === mat);

  if (isColorido) {
    // vendedor informa o valor da chapa
    const valorChapa = num(form.valorChapaColorida);
    const areaChapa  = CHAPA_AREA;
    if (form.cobrarPor === "chapa") return valorChapa * chapas;
    return (valorChapa / areaChapa) * areaTotal;
  }
  // branco — gerente configura
  const cfg = config.materialBranco?.[mat];
  if (!cfg) return 0;
  if (form.cobrarPor === "chapa") return num(cfg.valorChapa) * chapas;
  return num(cfg.valorM2) * areaTotal;
}

function calcOrcamento(form, config) {
  if (!form.itens?.length || !form.tipoMaterial || !form.donoDaMaterial) return null;

  let tempoProjetoH = 0;
  let tempoUsinagemH = 0;
  form.itens.forEach(it => {
    tempoProjetoH  += calcTempoProjetoHoras(it);
    tempoUsinagemH += calcTempoUsinagemHoras(it);
  });
  const tempoSetupH = 0.25;

  const custoOperador    = (tempoProjetoH + tempoSetupH) * num(config.valorHoraOperador);
  const custoMaquina     = tempoUsinagemH * num(config.valorHoraMaquina);
  const custoMO          = custoOperador + custoMaquina;
  const consumoKWh      = (num(config.potenciaSpindle) + num(config.potenciaExtras)) * tempoUsinagemH;
  const custoEnergia    = consumoKWh * num(config.tarifaEnergia);
  const custoManutencao = num(config.custoManutencaoHora) * tempoUsinagemH;
  const custoMat        = calcCustoMaterial(form, config);
  const custoBase       = custoMO + custoEnergia + custoManutencao + custoMat;
  const valorFinal      = custoBase * (1 + num(config.margem) / 100);
  const lucro           = valorFinal - custoBase;
  const areaTotal       = calcAreaTotal(form.itens);
  const chapasNec       = calcChapas(areaTotal);
  const areaPerda       = chapasNec > 0 ? chapasNec * CHAPA_AREA - areaTotal : 0;

  return { tempoProjetoH, tempoSetupH, tempoUsinagemH, consumoKWh, custoOperador, custoMaquina, custoMO, custoEnergia, custoManutencao, custoMat, custoBase, valorFinal, lucro, areaTotal, chapasNec, areaPerda };
}

// ── primitives ────────────────────────────────────────────────────────────────
const inputBase = (f) => ({ width:"100%", boxSizing:"border-box", background:"#0f0f0f", border:`1px solid ${f?"#e8e8e8":"#2a2a2a"}`, borderRadius:8, padding:"10px 12px", color:"#ffffff", fontSize:14, fontFamily:"inherit", outline:"none", transition:"border-color .2s" });

const NumInput = ({ value, onChange, unit, placeholder, small }) => {
  const [f,setF] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <input type="number" min="0" step="any" value={value} placeholder={placeholder||""} onChange={e=>onChange(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{ ...inputBase(f), paddingRight:unit?52:12, fontSize:small?12:14, padding:small?"7px 44px 7px 10px":"10px 52px 10px 12px" }} />
      {unit && <span style={{ position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",color:"#888888",fontSize:10,fontWeight:700 }}>{unit}</span>}
    </div>
  );
};

const TextInput = ({ value, onChange, placeholder, multiline }) => {
  const [f,setF] = useState(false);
  if (multiline) return <textarea value={value} placeholder={placeholder||""} rows={3} onChange={e=>onChange(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)} style={{ ...inputBase(f), resize:"vertical", lineHeight:1.5 }} />;
  return <input type="text" value={value} placeholder={placeholder||""} onChange={e=>onChange(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)} style={inputBase(f)} />;
};

const Field = ({ label, children, small }) => (
  <div style={{ marginBottom:small?8:14 }}>
    <label style={{ display:"block", fontSize:small?9:10, fontWeight:700, letterSpacing:"0.1em", color:"#aaaaaa", textTransform:"uppercase", marginBottom:4 }}>{label}</label>
    {children}
  </div>
);

const Card = ({ title, icon, accent="#e8e8e8", children, noPad }) => (
  <div style={{ background:"linear-gradient(140deg,#111111,#181818)", border:"1px solid #1e1e1e", borderRadius:14, padding:noPad?0:20, marginBottom:16, position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute",top:0,left:0,width:3,height:"100%",background:accent,borderRadius:"14px 0 0 14px" }} />
    {title && <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:noPad?"16px 20px 0":0 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontSize:11,fontWeight:800,color:"#cccccc",letterSpacing:"0.1em",textTransform:"uppercase" }}>{title}</span>
    </div>}
    <div style={{ padding:noPad?"0 20px 16px":0 }}>{children}</div>
  </div>
);

const Chip = ({ active, onClick, color, children, small }) => (
  <div onClick={onClick} style={{ cursor:onClick?"pointer":"default", userSelect:"none", padding:small?"5px 8px":"8px 10px", borderRadius:8, textAlign:"center", background:active?`${color}22`:"#0f0f0f", border:`1px solid ${active?color:"#2a2a2a"}`, color:active?color:"#777777", fontSize:small?10:11, fontWeight:700, transition:"all .2s" }}>{children}</div>
);

const Row = ({ label, value, bold, color }) => (
  <div style={{ display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #222222" }}>
    <span style={{ fontSize:12,color:bold?"#ffffff":"#999999",fontWeight:bold?700:400 }}>{label}</span>
    <span style={{ fontSize:12,color:color||(bold?"#e8e8e8":"#cccccc"),fontWeight:bold?800:600 }}>{value}</span>
  </div>
);

// ── CONFIG ────────────────────────────────────────────────────────────────────
function ConfigScreen({ config, setConfig, onSave }) {
  const set = k => v => setConfig(p => ({ ...p, [k]: v }));
  const setMB = (id, field) => v => setConfig(p => ({ ...p, materialBranco: { ...p.materialBranco, [id]: { ...p.materialBranco[id], [field]: v } } }));

  const ok = ["valorHoraOperador","valorHoraMaquina","potenciaSpindle","potenciaExtras","tarifaEnergia","custoManutencaoHora","margem"].every(k => config[k] !== "");

  return (
    <div>
      <div style={{ textAlign:"center",marginBottom:28 }}>
        <p style={{ margin:0,fontSize:12,color:"#e8e8e8",letterSpacing:"0.1em",textTransform:"uppercase" }}>Área do Gerente</p>
        <h2 style={{ margin:"6px 0 0",fontSize:20,fontWeight:900,color:"#ffffff" }}>Configurações</h2>
      </div>

      <Card title="Mão de Obra & Máquina" icon="👷" accent="#7c3aed">
        <Field label="Valor hora do operador / programador"><NumInput value={config.valorHoraOperador} onChange={set("valorHoraOperador")} unit="R$/h" /></Field>
        <Field label="Valor hora da máquina CNC"><NumInput value={config.valorHoraMaquina} onChange={set("valorHoraMaquina")} unit="R$/h" /></Field>
        <div style={{ background:"#0f0f0f",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#666" }}>
          💡 Hora da máquina = depreciação + energia + manutenção ÷ horas trabalhadas/mês
          {num(config.valorHoraMaquina) > 0 && <div style={{ color:"#e8e8e8",marginTop:4,fontWeight:700 }}>Custo/hora configurado: {BRL(config.valorHoraMaquina)}</div>}
        </div>
      </Card>

      <Card title="Energia Elétrica" icon="⚡" accent="#f59e0b">
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
          <Field label="Potência spindle"><NumInput value={config.potenciaSpindle} onChange={set("potenciaSpindle")} unit="kW" /></Field>
          <Field label="Extras (aspirador)"><NumInput value={config.potenciaExtras} onChange={set("potenciaExtras")} unit="kW" /></Field>
        </div>
        <Field label="Tarifa de energia"><NumInput value={config.tarifaEnergia} onChange={set("tarifaEnergia")} unit="R$/kWh" /></Field>
      </Card>

      <Card title="Manutenção & Desgaste" icon="🔧" accent="#ef4444">
        <Field label="Custo manutenção por hora de máquina"><NumInput value={config.custoManutencaoHora} onChange={set("custoManutencaoHora")} unit="R$/h" /></Field>
      </Card>

      <Card title="Margem de Lucro" icon="📈" accent="#e8e8e8">
        <Field label="Margem geral aplicada a todos os orçamentos"><NumInput value={config.margem} onChange={set("margem")} unit="%" /></Field>
      </Card>

      <Card title="Chapas Brancas — Preços" icon="⬜" accent="#e8e8e8">
        <p style={{ margin:"0 0 14px",fontSize:11,color:"#777777" }}>Configure valor por m² e por chapa. Chapas coloridas são informadas pelo vendedor.</p>
        {MATERIAIS_BRANCOS.map(m => {
          const cfg = config.materialBranco?.[m.id] || { valorM2:"", valorChapa:"" };
          return (
            <div key={m.id} style={{ background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:10,padding:14,marginBottom:10 }}>
              <div style={{ fontSize:12,fontWeight:800,color:"#e8e8e8",marginBottom:10 }}>⬜ {m.label}</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                <Field label="Por m²"><NumInput value={cfg.valorM2} onChange={setMB(m.id,"valorM2")} unit="R$/m²" placeholder="opcional" /></Field>
                <Field label="Por chapa"><NumInput value={cfg.valorChapa} onChange={setMB(m.id,"valorChapa")} unit="R$" placeholder="opcional" /></Field>
              </div>
            </div>
          );
        })}
      </Card>

      <button onClick={onSave} disabled={!ok} style={{ width:"100%",padding:14,borderRadius:10,border:"none",cursor:ok?"pointer":"not-allowed", background:ok?"linear-gradient(90deg,#e8e8e8,#e8e8e8)":"#1e1e1e", color:ok?"#001a2e":"#888888",fontFamily:"inherit",fontSize:13,fontWeight:900,letterSpacing:"0.1em",textTransform:"uppercase",transition:"all .2s" }}>
        {ok ? "✓ Salvar configurações" : "Preencha os campos obrigatórios"}
      </button>
    </div>
  );
}

// ── ITEM EDITOR ───────────────────────────────────────────────────────────────
const emptyItem = () => ({ id: Date.now()+Math.random(), geometria:"", largura:"", altura:"", lado:"", diametro:"", lados:"5", quantidade:"1", ferramenta:"standard" });

function ItemEditor({ item, onChange, onRemove, index }) {
  const geo = GEOMETRIAS.find(g => g.id === item.geometria);
  const set = k => v => onChange({ ...item, [k]: v });
  const { largura, altura } = getDimensoes(item);
  const isBig = largura >= 500 && altura >= 500;

  return (
    <div style={{ background:"#0f0f0f",border:"1px solid #222222",borderRadius:12,padding:14,marginBottom:10 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
        <span style={{ fontSize:11,color:"#e8e8e8",fontWeight:800,letterSpacing:"0.08em" }}>ITEM {index+1} {geo ? `— ${geo.icon} ${geo.label}` : ""}</span>
        <button onClick={onRemove} style={{ background:"none",border:"1px solid #2a1010",borderRadius:6,cursor:"pointer",color:"#6a2a2a",fontSize:11,padding:"2px 8px",fontFamily:"inherit" }}
          onMouseEnter={e=>{e.target.style.color="#ef4444";e.target.style.borderColor="#ef444450";}}
          onMouseLeave={e=>{e.target.style.color="#6a2a2a";e.target.style.borderColor="#2a1010";}}>
          🗑️
        </button>
      </div>

      {/* Geometria */}
      <Field label="Geometria" small>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10 }}>
          {GEOMETRIAS.map(g => (
            <Chip key={g.id} active={item.geometria===g.id} onClick={() => set("geometria")(g.id)} color={g.id==="especiais"?"#f59e0b":g.muxarabi?"#10b981":"#7c3aed"} small>
              <div style={{ fontSize:14 }}>{g.icon}</div>
              <div style={{ fontSize:9,marginTop:1 }}>{g.label}</div>
              {g.extra && <div style={{ fontSize:8,color:"#f59e0b" }}>{g.extra}</div>}
              {g.muxarabi && <div style={{ fontSize:8,color:"#10b981" }}>{Math.round((g.progS+g.maqS)/60)}min ref</div>}
            </Chip>
          ))}
        </div>
      </Field>

      {/* Dimensões inline */}
      {item.geometria && (
        <div style={{ display:"grid",gap:8 }}>
          {item.geometria === "quadrado" && (
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
              <Field label="Lado" small><NumInput value={item.lado} onChange={set("lado")} unit="mm" small /></Field>
              <Field label="Qtd" small><NumInput value={item.quantidade} onChange={set("quantidade")} unit="pç" small /></Field>
            </div>
          )}
          {item.geometria === "circulo" && (
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
              <Field label="Diâmetro" small><NumInput value={item.diametro} onChange={set("diametro")} unit="mm" small /></Field>
              <Field label="Qtd" small><NumInput value={item.quantidade} onChange={set("quantidade")} unit="pç" small /></Field>
            </div>
          )}
          {["retangulo","oval","especiais","muxarabi_50","muxarabi_70","muxarabi_100"].includes(item.geometria) && (
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
              <Field label="Largura" small><NumInput value={item.largura} onChange={set("largura")} unit="mm" small /></Field>
              <Field label="Altura" small><NumInput value={item.altura} onChange={set("altura")} unit="mm" small /></Field>
              <Field label="Qtd" small><NumInput value={item.quantidade} onChange={set("quantidade")} unit="pç" small /></Field>
            </div>
          )}
          {item.geometria === "poligono" && (
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8 }}>
              <Field label="Largura" small><NumInput value={item.largura} onChange={set("largura")} unit="mm" small /></Field>
              <Field label="Altura" small><NumInput value={item.altura} onChange={set("altura")} unit="mm" small /></Field>
              <Field label="Lados" small><NumInput value={item.lados} onChange={set("lados")} unit="" small /></Field>
              <Field label="Qtd" small><NumInput value={item.quantidade} onChange={set("quantidade")} unit="pç" small /></Field>
            </div>
          )}

          {/* Ferramenta — só para não-muxarabi */}
          {!geo?.muxarabi && (
            <Field label="Tipo de corte" small>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
                <Chip active={item.ferramenta==="standard"} onClick={() => set("ferramenta")("standard")} color="#e8e8e8" small>⚙️ Standard{largura>0&&altura>0?` · ${isBig?"1 passada":"2 passadas"}`:""}</Chip>
                <Chip active={item.ferramenta==="especial"} onClick={() => set("ferramenta")("especial")} color="#f59e0b" small>⭐ Especial · +50% tempo</Chip>
              </div>
            </Field>
          )}

          {/* Info de área e tempos */}
          {largura > 0 && altura > 0 && (
            <div style={{ background:"#050505",borderRadius:6,padding:"8px 10px",fontSize:10,color:"#666",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8 }}>
              <div>Área<br/><b style={{ color:"#e8e8e8" }}>{((largura/1000)*(altura/1000)).toFixed(4)} m²</b></div>
              <div>Total ({item.quantidade} pç)<br/><b style={{ color:"#e8e8e8" }}>{((largura/1000)*(altura/1000)*num(item.quantidade)).toFixed(4)} m²</b></div>
              <div>Programação<br/><b style={{ color:"#e8e8e8" }}>{formatSec(calcTempos(item).progH*3600)}</b></div>
              <div>Máquina<br/><b style={{ color:"#e8e8e8" }}>{formatSec(calcTempos(item).maqH*3600)}</b></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── QUOTE SCREEN ──────────────────────────────────────────────────────────────
function QuoteScreen({ config }) {
  const [form, setForm] = useState({
    vendedor:"", cliente:"", descricao:"",
    itens: [emptyItem()],
    tipoMaterial:"", donoDaMaterial:"", cobrarPor:"m2", valorChapaColorida:"",
  });
  const [saved, setSaved] = useState(false);
  const set = k => v => setForm(p => {
    // Reset tipoMaterial quando troca donoDaMaterial
    if (k === 'donoDaMaterial') return { ...p, [k]: v, tipoMaterial: '', valorChapaColorida: '' };
    return { ...p, [k]: v };
  });

  const addItem = () => setForm(p => ({ ...p, itens: [...p.itens, emptyItem()] }));
  const removeItem = i => setForm(p => ({ ...p, itens: p.itens.filter((_,j) => j!==i) }));
  const updateItem = (i, it) => setForm(p => ({ ...p, itens: p.itens.map((x,j) => j===i?it:x) }));

  const matSel = TODOS_MATERIAIS.find(m => m.id === form.tipoMaterial);
  const isColorido = MATERIAIS_COLORIDOS.some(m => m.id === form.tipoMaterial);
  const isBranco   = MATERIAIS_BRANCOS.some(m => m.id === form.tipoMaterial);

  const areaTotal  = calcAreaTotal(form.itens);
  const chapasNec  = calcChapas(areaTotal);
  const precisaMaisDeUmaChapa = chapasNec > 1;

  const result = calcOrcamento(form, config);

  // Show cobrarPor: branco com ambos valores, ou colorido sempre que valor preenchido
  const cfgBranco = config.materialBranco?.[form.tipoMaterial];
  const showCobrarPor = form.donoDaMaterial === "nossa" && (
    (isBranco && num(cfgBranco?.valorM2) > 0 && num(cfgBranco?.valorChapa) > 0) ||
    (isColorido && num(form.valorChapaColorida) > 0)
  );

  const saveQuote = () => {
    if (!result) return;
    const snap = { id:Date.now(), date:new Date().toLocaleDateString("pt-BR"), form:{...form}, result:{...result}, status:"pendente" };
    const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY)||"[]");
    quotes.unshift(snap);
    localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes.slice(0,100)));
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const itensOk = form.itens.some(it => {
    const { largura, altura } = getDimensoes(it);
    return it.geometria && largura > 0 && altura > 0 && num(it.quantidade) > 0;
  });
  const matOk = form.tipoMaterial && form.donoDaMaterial && (
    form.donoDaMaterial === "cliente" ||
    (isBranco) ||
    (isColorido && num(form.valorChapaColorida) > 0)
  );
  const ready = itensOk && matOk;

  return (
    <div>
      <div style={{ textAlign:"center",marginBottom:24 }}>
        <p style={{ margin:0,fontSize:12,color:"#e8e8e8",letterSpacing:"0.1em",textTransform:"uppercase" }}>Gerador de Orçamento</p>
        <h2 style={{ margin:"6px 0 0",fontSize:20,fontWeight:900,color:"#ffffff" }}>Nova cotação</h2>
      </div>

      {/* Identificação */}
      <Card title="Identificação" icon="👤" accent="#e8e8e8">
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
          <Field label="Vendedor"><TextInput value={form.vendedor} onChange={set("vendedor")} placeholder="Nome do vendedor" /></Field>
          <Field label="Cliente"><TextInput value={form.cliente} onChange={set("cliente")} placeholder="Nome do cliente" /></Field>
        </div>
        <Field label="Descrição do serviço"><TextInput value={form.descricao} onChange={set("descricao")} placeholder="Descreva o serviço..." multiline /></Field>
      </Card>

      {/* Itens / geometrias */}
      <Card title="Peças do Orçamento" icon="📐" accent="#7c3aed">
        {form.itens.map((it, i) => (
          <ItemEditor key={it.id} item={it} index={i} onChange={it => updateItem(i,it)} onRemove={() => removeItem(i)} />
        ))}
        <button onClick={addItem} style={{ width:"100%",padding:10,borderRadius:8,border:"1px dashed #333333",cursor:"pointer",background:"transparent",color:"#e8e8e8",fontFamily:"inherit",fontSize:12,fontWeight:700,marginTop:4 }}>
          + Adicionar geometria
        </button>

        {/* Resumo de área */}
        {areaTotal > 0 && (
          <div style={{ background:"#0a0a0a",borderRadius:8,padding:"10px 14px",marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9,color:"#777777",textTransform:"uppercase",marginBottom:2 }}>Área total</div>
              <div style={{ fontSize:14,fontWeight:800,color:"#e8e8e8" }}>{areaTotal.toFixed(4)} m²</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9,color:"#777777",textTransform:"uppercase",marginBottom:2 }}>Chapas nec.</div>
              <div style={{ fontSize:14,fontWeight:800,color:"#f59e0b" }}>{chapasNec} chp</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9,color:"#777777",textTransform:"uppercase",marginBottom:2 }}>Perda</div>
              <div style={{ fontSize:14,fontWeight:800,color:"#ef4444" }}>{(chapasNec*CHAPA_AREA-areaTotal).toFixed(4)} m²</div>
            </div>
          </div>
        )}
      </Card>

      {/* Material */}
      <Card title="Material" icon="📦" accent="#f59e0b">
        <Field label="A chapa é nossa ou do cliente?">
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}>
            <Chip active={form.donoDaMaterial==="nossa"} onClick={()=>set("donoDaMaterial")("nossa")} color="#e8e8e8">
              <div style={{ fontSize:16,marginBottom:2 }}>🏭</div><div>Nossa</div>
              <div style={{ fontSize:9,color:"#777777",marginTop:2 }}>cobrar material</div>
            </Chip>
            <Chip active={form.donoDaMaterial==="cliente"} onClick={()=>set("donoDaMaterial")("cliente")} color="#22c55e">
              <div style={{ fontSize:16,marginBottom:2 }}>👤</div><div>Do cliente</div>
              <div style={{ fontSize:9,color:"#777777",marginTop:2 }}>só o serviço</div>
            </Chip>
          </div>
        </Field>

        {form.donoDaMaterial === "nossa" && (
          <>
            <Field label="Tipo de material">
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:9,color:"#777777",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6 }}>⬜ Chapas Brancas</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12 }}>
                  {MATERIAIS_BRANCOS.map(m => <Chip key={m.id} active={form.tipoMaterial===m.id} onClick={()=>set("tipoMaterial")(m.id)} color="#e8e8e8" small>{m.label}</Chip>)}
                </div>
                <div style={{ fontSize:9,color:"#777777",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6 }}>🎨 Chapas Coloridas</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>
                  {MATERIAIS_COLORIDOS.map(m => <Chip key={m.id} active={form.tipoMaterial===m.id} onClick={()=>set("tipoMaterial")(m.id)} color="#7c3aed" small>{m.label}</Chip>)}
                </div>
              </div>
            </Field>

            {/* Espessura automática */}
            {matSel && (
              <div style={{ background:"#0f0f0f",borderRadius:8,padding:"7px 12px",marginBottom:14,fontSize:11,display:"flex",gap:8,alignItems:"center" }}>
                <span style={{ color:"#e8e8e8",fontWeight:700 }}>◼ Espessura: {matSel.espessura}mm</span>
                <span style={{ color:"#777777" }}>— definida pelo material</span>
              </div>
            )}

            {/* Colorido: vendedor informa valor */}
            {isColorido && (
              <Field label="Valor da chapa colorida (informado pelo vendedor)">
                <NumInput value={form.valorChapaColorida} onChange={set("valorChapaColorida")} unit="R$" placeholder="Digite o valor atual" />
              </Field>
            )}

            {/* Cobrar por — só quando faz sentido */}
            {showCobrarPor && (
              <Field label={`Forma de cobrança${!precisaMaisDeUmaChapa?" (área < 1 chapa → automático m²)":""}`}>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                  <Chip active={form.cobrarPor==="m2"} onClick={()=>set("cobrarPor")("m2")} color="#e8e8e8">
                    📐 Por m²
                    {isBranco && num(cfgBranco?.valorM2)>0 ? ` · ${BRL(cfgBranco.valorM2)}/m²` : ""}
                    {isColorido && num(form.valorChapaColorida)>0 ? ` · ${BRL(num(form.valorChapaColorida)/CHAPA_AREA)}/m²` : ""}
                  </Chip>
                  <Chip active={form.cobrarPor==="chapa"} onClick={()=>set("cobrarPor")("chapa")} color="#f59e0b">
                    🗂️ Por chapa
                    {isBranco && num(cfgBranco?.valorChapa)>0 ? ` · ${BRL(cfgBranco.valorChapa)}` : ""}
                    {isColorido && num(form.valorChapaColorida)>0 ? ` · ${BRL(form.valorChapaColorida)}` : ""}
                  </Chip>
                </div>
              </Field>
            )}

            {/* Cálculo automático de chapas */}
            {form.tipoMaterial && areaTotal > 0 && (
              <div style={{ background:"#0a1f10",border:"1px solid #22c55e44",borderRadius:8,padding:"10px 12px" }}>
                <div style={{ fontSize:11,color:"#22c55e",fontWeight:700,marginBottom:4 }}>✓ Cálculo automático de chapas</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>
                  <div style={{ fontSize:10,color:"#888888" }}>Área útil<br/><b style={{ color:"#ffffff" }}>{areaTotal.toFixed(3)} m²</b></div>
                  <div style={{ fontSize:10,color:"#888888" }}>Chapas<br/><b style={{ color:"#f59e0b" }}>{chapasNec} chp</b></div>
                  <div style={{ fontSize:10,color:"#888888" }}>Aproveitamento<br/><b style={{ color:"#ffffff" }}>{(areaTotal/(chapasNec*CHAPA_AREA)*100).toFixed(1)}%</b></div>
                </div>
              </div>
            )}
          </>
        )}

        {form.donoDaMaterial === "cliente" && (
          <>
            <Field label="Tipo de material do cliente">
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:9,color:"#777777",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6 }}>⬜ Chapas Brancas</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12 }}>
                  {MATERIAIS_BRANCOS.map(m => <Chip key={m.id} active={form.tipoMaterial===m.id} onClick={()=>set("tipoMaterial")(m.id)} color="#e8e8e8" small>{m.label}</Chip>)}
                </div>
                <div style={{ fontSize:9,color:"#777777",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6 }}>🎨 Chapas Coloridas</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>
                  {MATERIAIS_COLORIDOS.map(m => <Chip key={m.id} active={form.tipoMaterial===m.id} onClick={()=>set("tipoMaterial")(m.id)} color="#7c3aed" small>{m.label}</Chip>)}
                </div>
              </div>
            </Field>
            {matSel && (
              <div style={{ background:"#0f0f0f",border:"1px solid #22c55e44",borderRadius:8,padding:"10px 12px",fontSize:11 }}>
                <div style={{ color:"#22c55e",fontWeight:700,marginBottom:4 }}>✓ Material do cliente registrado</div>
                <div style={{ color:"#888888" }}>◼ {matSel.label} — <b style={{ color:"#e8e8e8" }}>{matSel.espessura}mm</b></div>
                <div style={{ color:"#666666",marginTop:2 }}>Material não será cobrado — apenas o serviço de corte.</div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Resultado */}
      {result && (
        <>
          <div style={{ background:"linear-gradient(140deg,#111111,#181818)",border:"1px solid #1e1e1e",borderRadius:14,padding:20,marginBottom:16 }}>
            <div style={{ fontSize:11,fontWeight:800,color:"#cccccc",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14 }}>📋 Detalhamento</div>

            <div style={{ background:"#0f0f0f",borderRadius:8,padding:"10px 12px",marginBottom:10 }}>
              <div style={{ fontSize:10,color:"#777",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>⏱️ Tempos</div>
              <Row label="Programação (operador)" value={formatSec(result.tempoProjetoH*3600)} />
              <Row label="Setup" value={formatSec(result.tempoSetupH*3600)} />
              <Row label="Execução (máquina)" value={formatSec(result.tempoUsinagemH*3600)} />
              <Row label="Energia consumida" value={`${result.consumoKWh.toFixed(3)} kWh`} />
            </div>

            <div style={{ background:"#0f0f0f",borderRadius:8,padding:"10px 12px",marginBottom:10 }}>
              <div style={{ fontSize:10,color:"#777",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>💰 Custos</div>
              <Row label="Operador (prog + setup)" value={BRL(result.custoOperador)} />
              <Row label="Máquina (execução)" value={BRL(result.custoMaquina)} />
              <Row label="Energia" value={BRL(result.custoEnergia)} />
              <Row label="Manutenção" value={BRL(result.custoManutencao)} />
              <Row label={`Material${form.donoDaMaterial==="cliente"?" (do cliente)":""}`} value={form.donoDaMaterial==="cliente"?"Grátis":BRL(result.custoMat)} color={form.donoDaMaterial==="cliente"?"#22c55e":null} />
            </div>

            <div style={{ background:"#0f0f0f",borderRadius:8,padding:"10px 12px",marginBottom:10 }}>
              <div style={{ fontSize:10,color:"#777",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>📦 Chapas</div>
              <Row label="Área utilizada" value={`${result.areaTotal.toFixed(3)} m²`} />
              <Row label="Chapas necessárias" value={`${result.chapasNec} chp`} />
              <Row label="Área de perda" value={`${result.areaPerda.toFixed(3)} m²`} />
            </div>

            <Row label="Custo base total" value={BRL(result.custoBase)} bold />
          </div>

          <div style={{ background:"linear-gradient(135deg,#0a0a0a,#141414)",border:"2px solid #e8e8e8",borderRadius:16,padding:24,marginBottom:16,textAlign:"center",position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:-50,right:-50,width:150,height:150,background:"radial-gradient(circle,#e8e8e818,transparent)",borderRadius:"50%" }} />
            <div style={{ fontSize:11,color:"#999999",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6 }}>Margem {num(config.margem)}%</div>
            <div style={{ fontSize:11,color:"#999999",marginBottom:20 }}>{form.itens.reduce((s,i)=>s+num(i.quantidade),0)} peça(s) · {result.chapasNec} chapa(s)</div>
            <div style={{ fontSize:10,color:"#999999",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6 }}>Valor total do orçamento</div>
            <div style={{ fontSize:44,fontWeight:900,color:"#e8e8e8",letterSpacing:"-0.02em",lineHeight:1,textShadow:"0 0 40px #e8e8e840" }}>{BRL(result.valorFinal)}</div>
            <div style={{ fontSize:13,color:"#cccccc",marginTop:8 }}>{BRL(result.valorFinal/Math.max(form.itens.reduce((s,i)=>s+num(i.quantidade),0),1))} por peça</div>
            <button onClick={saveQuote} style={{ marginTop:18,padding:"10px 28px",borderRadius:8,border:`1px solid ${saved?"#22c55e":"#e8e8e8"}`,cursor:"pointer",background:saved?"#22c55e22":"#e8e8e822",color:saved?"#22c55e":"#e8e8e8",fontFamily:"inherit",fontSize:12,fontWeight:800,letterSpacing:"0.08em",transition:"all .3s" }}>
              {saved?"✓ Salvo!":"💾 Salvar orçamento"}
            </button>
          </div>
        </>
      )}
      {!ready && (
        <div style={{ textAlign:"center",padding:"32px 0",color:"#555555",fontSize:13 }}>
          Preencha as peças e o material para ver o orçamento.
        </div>
      )}
    </div>
  );
}

// ── HISTORY / PRODUÇÃO / PRODUZIDOS ──────────────────────────────────────────
function QuoteList({ filter, title, subtitle, emptyMsg, emptyIcon, actionLabel, actionStatus, nextStatus, accentColor }) {
  const [quotes, setQuotes] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = () => setQuotes(JSON.parse(localStorage.getItem(QUOTES_KEY)||"[]"));
  useEffect(load, []);

  const updateStatus = (id, status) => {
    const updated = quotes.map(q => q.id===id ? { ...q, status } : q);
    setQuotes(updated);
    localStorage.setItem(QUOTES_KEY, JSON.stringify(updated));
    if (selected?.id===id) setSelected({ ...selected, status });
  };

  const deleteQuote = (id) => {
    const updated = quotes.filter(q => q.id!==id);
    setQuotes(updated);
    localStorage.setItem(QUOTES_KEY, JSON.stringify(updated));
    if (selected?.id===id) setSelected(null);
  };

  const filtered = filter ? quotes.filter(q => q.status===filter) : quotes;

  if (selected) {
    const q = selected;
    return (
      <div>
        <button onClick={()=>setSelected(null)} style={{ background:"none",border:"none",color:"#e8e8e8",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,marginBottom:20,padding:0 }}>← Voltar</button>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <h2 style={{ margin:0,fontSize:18,fontWeight:900,color:"#ffffff" }}>{q.form?.cliente||"Sem cliente"}</h2>
          <p style={{ margin:"4px 0 0",fontSize:11,color:"#777777" }}>{q.date} · 👤 {q.form?.vendedor||"—"}</p>
          {q.form?.descricao && <p style={{ margin:"8px auto 0",fontSize:12,color:"#bbbbbb",maxWidth:400,lineHeight:1.5 }}>{q.form.descricao}</p>}
        </div>

        {/* Itens */}
        <Card title="Peças" icon="📐" accent="#7c3aed">
          {q.form?.itens?.map((it,i) => {
            const geo = GEOMETRIAS.find(g=>g.id===it.geometria);
            const { largura, altura } = getDimensoes(it);
            return (
              <div key={i} style={{ padding:"8px 0",borderBottom:"1px solid #222222" }}>
                <span style={{ fontSize:12,color:"#ffffff",fontWeight:700 }}>{geo?.icon} {geo?.label}</span>
                <span style={{ fontSize:11,color:"#bbbbbb",marginLeft:8 }}>{largura}×{altura}mm · {it.quantidade} pç · {it.ferramenta==="especial"?"⭐ Especial":"⚙️ Standard"}</span>
              </div>
            );
          })}
        </Card>

        <Card title="Custos" icon="📋" accent="#e8e8e8">
          <Row label="Operador (prog+setup)" value={BRL(q.result?.custoOperador)} />
          <Row label="Máquina (execução)" value={BRL(q.result?.custoMaquina)} />
          <Row label="Energia" value={BRL(q.result?.custoEnergia)} />
          <Row label="Manutenção" value={BRL(q.result?.custoManutencao)} />
          <Row label="Material" value={q.form?.donoDaMaterial==="cliente"?"Grátis":BRL(q.result?.custoMat)} color={q.form?.donoDaMaterial==="cliente"?"#22c55e":null} />
          <Row label="Área utilizada" value={`${(q.result?.areaTotal||0).toFixed(3)} m²`} />
          <Row label="Chapas necessárias" value={`${q.result?.chapasNec||0} chp`} />
          <Row label="Área de perda" value={`${(q.result?.areaPerda||0).toFixed(3)} m²`} />
          <Row label="Custo base" value={BRL(q.result?.custoBase)} bold />
          <Row label="Valor final" value={BRL(q.result?.valorFinal)} bold color="#e8e8e8" />
        </Card>

        {/* Action button */}
        {actionLabel && q.status !== nextStatus && (
          <button onClick={()=>{ updateStatus(q.id, nextStatus); setSelected(null); }} style={{ width:"100%",padding:14,borderRadius:10,border:`1px solid ${accentColor}`,cursor:"pointer",background:`${accentColor}22`,color:accentColor,fontFamily:"inherit",fontSize:13,fontWeight:800,letterSpacing:"0.08em",marginBottom:10 }}>
            {actionLabel}
          </button>
        )}
        {q.status === nextStatus && (
          <div style={{ textAlign:"center",padding:"10px",fontSize:12,color:accentColor,fontWeight:700,marginBottom:10 }}>✓ {actionLabel?.replace(/^[^\s]+\s/,"")} — concluído</div>
        )}

        <button onClick={()=>deleteQuote(q.id)} style={{ width:"100%",padding:14,borderRadius:10,border:"1px solid #ef444460",cursor:"pointer",background:"#1a0808",color:"#ef4444",fontFamily:"inherit",fontSize:12,fontWeight:800 }}>🗑️ Excluir</button>
      </div>
    );
  }

  if (!filtered.length) return (
    <div style={{ textAlign:"center",padding:"60px 0",color:"#555555" }}>
      <div style={{ fontSize:40,marginBottom:12 }}>{emptyIcon}</div>
      <p style={{ fontSize:13 }}>{emptyMsg}</p>
    </div>
  );

  return (
    <div>
      <div style={{ textAlign:"center",marginBottom:24 }}>
        <p style={{ margin:0,fontSize:12,color:accentColor,letterSpacing:"0.1em",textTransform:"uppercase" }}>{subtitle}</p>
        <h2 style={{ margin:"6px 0 0",fontSize:20,fontWeight:900,color:"#ffffff" }}>{title}</h2>
        <p style={{ margin:"6px 0 0",fontSize:11,color:"#777777" }}>{filtered.length} registro{filtered.length>1?"s":""} · Toque para detalhes</p>
      </div>
      {filtered.map((q,i) => {
        const statusColor = q.status==="aprovado"?"#f59e0b":q.status==="produzido"?"#22c55e":"#e8e8e8";
        const statusLabel = { pendente:"⏳ Pendente", aprovado:"✅ Aprovado", produzido:"🏭 Produzido" }[q.status]||q.status;
        const totalPecas = q.form?.itens?.reduce((s,it)=>s+num(it.quantidade),0)||0;
        return (
          <div key={q.id} onClick={()=>setSelected(q)} style={{ background:"linear-gradient(140deg,#111111,#181818)",border:`1px solid ${q.status!=="pendente"?statusColor+"44":"#1e1e1e"}`,borderRadius:12,padding:16,marginBottom:10,cursor:"pointer",transition:"border-color .2s" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                  <span style={{ fontSize:10,color:"#777777" }}>#{filtered.length-i} · {q.date}</span>
                  <span style={{ fontSize:9,background:`${statusColor}22`,color:statusColor,padding:"1px 6px",borderRadius:10,fontWeight:700 }}>{statusLabel}</span>
                </div>
                {(q.form?.vendedor||q.form?.cliente) && (
                  <div style={{ fontSize:11,color:"#bbbbbb",marginBottom:2 }}>
                    {q.form.vendedor&&<span>👤 {q.form.vendedor}</span>}
                    {q.form.vendedor&&q.form.cliente&&<span style={{ color:"#333333" }}> · </span>}
                    {q.form.cliente&&<span>🏢 {q.form.cliente}</span>}
                  </div>
                )}
                <div style={{ fontSize:12,color:"#ffffff",fontWeight:700 }}>
                  {q.form?.itens?.map(it=>{ const g=GEOMETRIAS.find(x=>x.id===it.geometria); return g?`${g.icon}×${it.quantidade}`:null; }).filter(Boolean).join("  ")}
                </div>
                {q.form?.descricao&&<div style={{ fontSize:11,color:"#777777",marginTop:2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",maxWidth:200 }}>{q.form.descricao}</div>}
              </div>
              <div style={{ textAlign:"right",marginLeft:12 }}>
                <div style={{ fontSize:9,color:"#777777" }}>{totalPecas} pç · {q.result?.chapasNec||0} chp</div>
                <div style={{ fontSize:20,fontWeight:900,color:"#e8e8e8" }}>{BRL(q.result?.valorFinal)}</div>
              </div>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              {actionLabel && q.status!==nextStatus && (
                <button onClick={e=>{e.stopPropagation();updateStatus(q.id,nextStatus);}} style={{ background:`${accentColor}22`,border:`1px solid ${accentColor}50`,borderRadius:6,cursor:"pointer",color:accentColor,fontSize:11,padding:"3px 10px",fontFamily:"inherit",fontWeight:700 }}>
                  {actionLabel}
                </button>
              )}
              {(!actionLabel||q.status===nextStatus) && <span/>}
              <button onClick={e=>{e.stopPropagation();deleteQuote(q.id);}} style={{ background:"none",border:"1px solid #2a1010",borderRadius:6,cursor:"pointer",color:"#6a2a2a",fontSize:11,padding:"2px 8px",fontFamily:"inherit" }}
                onMouseEnter={e=>{e.target.style.color="#ef4444";}} onMouseLeave={e=>{e.target.style.color="#6a2a2a";}}>🗑️</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
      return { ...defaultConfig, ...s, materialBranco:{ ...defaultConfig.materialBranco,...(s.materialBranco||{}) } };
    } catch { return defaultConfig; }
  });

  const isConfigured = () => ["valorHoraOperador","valorHoraMaquina","potenciaSpindle","potenciaExtras","tarifaEnergia","custoManutencaoHora","margem"].every(k => config[k] !== "");

  const [configured, setConfigured] = useState(isConfigured);
  const [tab, setTab] = useState(isConfigured()?"quote":"config");

  const saveConfig = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setConfigured(true); setTab("quote");
  };

  const tabs = [
    { id:"quote",     label:"Orçamento",  icon:"🧮", disabled:!configured },
    { id:"orcamentos",label:"Orçamentos", icon:"📂", disabled:!configured },
    { id:"producao",  label:"Produção",   icon:"⚙️", disabled:!configured },
    { id:"produzidos",label:"Produzidos", icon:"✅", disabled:!configured },
    { id:"config",    label:"Gerente",    icon:"⚙️", disabled:false },
  ];

  return (
    <div style={{ minHeight:"100vh",background:"radial-gradient(ellipse at 20% 0%,#0a0a0a,#000000 60%,#000000)",fontFamily:"'IBM Plex Mono','Courier New',monospace",color:"#ffffff" }}>
      <div style={{ background:"linear-gradient(90deg,#000000,#0a0a0a)",borderBottom:"1px solid #222222",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:28,height:28,background:"linear-gradient(135deg,#ffffff,#cccccc)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>⚡</div>
          <div>
            <div style={{ fontSize:13,fontWeight:900,letterSpacing:"0.05em",color:"#fff",lineHeight:1 }}>CNC <span style={{ color:"#e8e8e8" }}>SMART</span> COST</div>
            <div style={{ fontSize:8,color:"#888888",letterSpacing:"0.12em" }}>PRECIFICAÇÃO INTELIGENTE</div>
          </div>
        </div>
        {configured&&<div style={{ display:"flex",alignItems:"center",gap:4 }}><div style={{ width:5,height:5,background:"#22c55e",borderRadius:"50%" }}/><span style={{ fontSize:8,color:"#22c55e",letterSpacing:"0.08em" }}>CONFIGURADO</span></div>}
      </div>

      <div style={{ maxWidth:600,margin:"0 auto",padding:"20px 16px 100px" }}>
        {tab==="config"     && <ConfigScreen config={config} setConfig={setConfig} onSave={saveConfig} />}
        {tab==="quote"      && <QuoteScreen config={config} />}
        {tab==="orcamentos" && <QuoteList filter={null} title="Orçamentos" subtitle="Todos os orçamentos" emptyMsg="Nenhum orçamento salvo." emptyIcon="📂" actionLabel="✅ Aprovar Serviço" actionStatus="pendente" nextStatus="aprovado" accentColor="#f59e0b" />}
        {tab==="producao"   && <QuoteList filter="aprovado" title="Em Produção" subtitle="Serviços aprovados" emptyMsg="Nenhum serviço em produção." emptyIcon="⚙️" actionLabel="🏭 Marcar como Produzido" actionStatus="aprovado" nextStatus="produzido" accentColor="#e8e8e8" />}
        {tab==="produzidos" && <QuoteList filter="produzido" title="Produzidos" subtitle="Serviços concluídos" emptyMsg="Nenhum serviço produzido ainda." emptyIcon="✅" accentColor="#22c55e" />}
      </div>

      <div style={{ position:"fixed",bottom:0,left:0,right:0,background:"#000000",borderTop:"1px solid #222222",display:"flex" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>!t.disabled&&setTab(t.id)} disabled={t.disabled} style={{ flex:1,padding:"10px 0 14px",background:"transparent",border:"none",cursor:t.disabled?"not-allowed":"pointer",color:tab===t.id?"#e8e8e8":t.disabled?"#333333":"#777777",transition:"color .2s",fontFamily:"inherit" }}>
            <div style={{ fontSize:t.id==="producao"?"14px":"18px",marginBottom:2 }}>{t.id==="producao"?"🏭":t.icon}</div>
            <div style={{ fontSize:8,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase" }}>{t.label}</div>
            {tab===t.id&&<div style={{ width:18,height:2,background:"#e8e8e8",margin:"3px auto 0",borderRadius:2 }}/>}
          </button>
        ))}
      </div>
    </div>
  );
}
