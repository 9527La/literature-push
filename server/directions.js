/**
 * Research-direction taxonomy — single source of truth for the AI
 * classification pipeline (server side).
 *
 * 15 first-class power-system research directions. The same list is mirrored
 * in `src/lib/directions.js` (labels + colours) for the front end, and spelled
 * out in full prose in `RUNBOOK-AI-DIRECTION.md` for the classifying agent.
 * Any change here must be applied in all three places (see README).
 */
export const DIRECTIONS = [
  {
    key: "distributed-gen",
    label: "分布式电源与并网",
    definition: "分布式光伏、风电等电源侧的并网运行、消纳能力、接入系统方案与场站控制。",
    signals: ["distributed generation", "grid integration", "curtailment", "PV plant", "wind farm", "消纳", "并网", "接入系统", "新能源场站"]
  },
  {
    key: "storage",
    label: "储能系统",
    definition: "电池/氢等储能系统的容量配置、运行优化、状态估计、全寿命周期与安全。",
    signals: ["battery energy storage", "BESS", "state of charge", "SOC", "capacity allocation", "second-life", "储能", "蓄电池", "容量配置"]
  },
  {
    key: "market",
    label: "电力市场与机制",
    definition: "电能量与辅助服务市场、竞价出清、定价结算、市场机制设计与激励相容。",
    signals: ["electricity market", "bidding", "auction", "tariff", "ancillary services", "settlement", "电力市场", "竞价", "电价", "辅助服务", "定价"]
  },
  {
    key: "transmission",
    label: "输电网运行与规划",
    definition: "输电系统的经济调度、机组组合、潮流、状态估计、网架规划与安全校核。",
    signals: ["transmission network", "OPF", "unit commitment", "SCED", "SCUC", "power flow", "expansion planning", "输电网", "潮流", "机组组合", "状态估计", "电网规划"]
  },
  {
    key: "distribution",
    label: "配电网运行与规划",
    definition: "配电网重构、网架与容量规划、电压/网损优化、馈线运行与软开关。",
    signals: ["distribution network", "reconfiguration", "feeder", "soft open point", "SOP", "distribution planning", "配电网", "馈线", "重构", "网损", "台区"]
  },
  {
    key: "microgrid",
    label: "微电网与虚拟电厂",
    definition: "微电网与虚拟电厂的能量管理、多主体聚合、并离网控制与聚合商运营。",
    signals: ["microgrid", "virtual power plant", "VPP", "energy management system", "EMS", "aggregation", "demand response", "微电网", "虚拟电厂", "聚合", "能量管理", "需求响应"]
  },
  {
    key: "forecasting",
    label: "预测与数据驱动",
    definition: "负荷、新能源出力、电价等预测，以及机器学习/深度学习在电力系统中的数据驱动应用。",
    signals: ["forecasting", "load prediction", "LSTM", "deep learning", "machine learning", "neural network", "预测", "负荷预测", "出力预测", "深度学习", "神经网络"]
  },
  {
    key: "stability",
    label: "电力系统稳定性",
    definition: "功角/频率/电压稳定、低频与次同步振荡、暂态稳定分析、稳定评估与控制。",
    signals: ["small-signal stability", "transient stability", "frequency stability", "oscillation", "damping", "low-inertia", "低频振荡", "次同步", "稳定", "阻尼", "惯量"]
  },
  {
    key: "protection",
    label: "继电保护与故障诊断",
    definition: "继电保护原理、故障检测与定位、行波测距、设备故障诊断。",
    signals: ["protection", "relay", "fault detection", "fault location", "traveling wave", "保护", "故障定位", "行波", "测距", "故障诊断"]
  },
  {
    key: "power-quality",
    label: "电能质量",
    definition: "谐波、电压暂降、闪变、三相不平衡的机理分析与治理。",
    signals: ["power quality", "harmonics", "voltage sag", "flicker", "imbalance", "active power filter", "电能质量", "谐波", "电压暂降", "闪变", "不平衡"]
  },
  {
    key: "hv",
    label: "高电压与绝缘",
    definition: "绝缘材料与特性、局部放电、过电压防护、防雷与高压试验。",
    signals: ["insulation", "partial discharge", "breakdown", "overvoltage", "lightning", "corona", "绝缘", "局部放电", "过电压", "防雷", "击穿", "耐压"]
  },
  {
    key: "power-electronics",
    label: "电力电子装备",
    definition: "变换器拓扑与控制、MMC、调制策略、宽禁带器件与电力电子装置本体。",
    signals: ["converter", "inverter", "rectifier", "MMC", "modulation", "PWM", "SiC", "GaN", "变流器", "逆变器", "调制", "宽禁带"]
  },
  {
    key: "transport",
    label: "电动汽车与电气化",
    definition: "电动汽车充电设施规划、充电负荷建模、车网互动与交通电气化供电。",
    signals: ["electric vehicle", "EV charging", "V2G", "charging station", "railway electrification", "电动汽车", "充电桩", "车网互动", "充电负荷", "轨道交通"]
  },
  {
    key: "ies",
    label: "综合能源系统",
    definition: "电-热-气-氢多能耦合系统、P2G、热电联产与区域综合能源优化。",
    signals: ["integrated energy system", "multi-energy", "power-to-gas", "P2G", "hydrogen", "CHP", "district heating", "综合能源", "多能互补", "电转气", "热电联产", "氢能"]
  },
  {
    key: "other",
    label: "其他/交叉",
    definition: "以上方向均不适配时使用：电机电器本体、超导、非能源电力装置等交叉主题。预期占比应低于 10%。"
  }
];

export const DIRECTION_KEYS = new Set(DIRECTIONS.map((direction) => direction.key));

export function isDirectionKey(key) {
  return DIRECTION_KEYS.has(String(key || ""));
}

export function directionLabel(key) {
  return DIRECTIONS.find((direction) => direction.key === key)?.label || "";
}

/** Prompt-ready catalogue: "key|label|definition|signals". */
export function directionCatalogueText() {
  return DIRECTIONS.map((direction) => {
    const signals = direction.signals ? direction.signals.join(", ") : "";
    return [direction.key, direction.label, direction.definition, signals].filter(Boolean).join(" | ");
  }).join("\n");
}
