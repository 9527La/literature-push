import { useEffect, useMemo, useState } from "react";
import { Compass, Filter, Mail, Pencil, Save, Send, Settings, UserRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { groupJournals } from "../../lib/journal.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";

function SettingsView(props) {
  if (!props.canEdit) return <GuestSettingsView />;
  return <SettingsEditor {...props} />;
}

function GuestSettingsView() {
  return (
    <section className="profile-layout" aria-labelledby="settings-account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">游客模式</span><h1 id="settings-account-title">文献推送设置</h1><p>游客可以浏览文献，但邮箱、订阅期刊和推送计划需要绑定到个人账户。</p></div>
      </div>
      <div className="guest-prompt"><UserRound size={20} /><div><strong>登录个人账户后管理自己的设置</strong><p>前往“游客账户”注册或登录，不会影响网页通行证。</p></div></div>
    </section>
  );
}

/**
 * CSV（推送方向过滤）→ 有序数组；空串 = 全部方向。
 * 顺序有意义（A3-4）：摘要邮件正文的方向分组按这里的存储顺序排列，
 * 因此选择态必须保序（点击先后），不能用 Set。
 */
function parseDirectionFilter(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function SettingsEditor({ settings, availableJournals, status, onSave }) {
  const [refreshCron, setRefreshCron] = useState(settings.refreshCron);
  const [userEmail, setUserEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  // 邮箱编辑态（需求 2）：已保存时只读，点「修改」才可编辑
  const [emailEditing, setEmailEditing] = useState(true);
  const [emailMsg, setEmailMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  // 推送期刊范围按出版社分组（需求 3），与筛选面板同一分组
  const pushJournalGroups = useMemo(() => groupJournals(availableJournals), [availableJournals]);

  useEffect(() => {
    // 邮箱拉取/保存后同步编辑态：有已保存邮箱即只读
    setEmailEditing(!savedEmail);
  }, [savedEmail]);

  // Push settings
  const [pushEnabled, setPushEnabled] = useState(settings.pushEnabled || false);
  const [pushFrequency, setPushFrequency] = useState(settings.pushFrequency || "weekly");
  const [pushCron, setPushCron] = useState(settings.pushCron || "0 8 * * 1");
  const [pushDays, setPushDays] = useState(settings.pushDays || 7);
  const [pushIncludeFile, setPushIncludeFile] = useState(settings.pushIncludeFile !== false);
  const [pushIncludeAbstract, setPushIncludeAbstract] = useState(settings.pushIncludeAbstract !== false);
  const [pushIncludeKeywords, setPushIncludeKeywords] = useState(settings.pushIncludeKeywords !== false);
  const [pushIncludeTranslation, setPushIncludeTranslation] = useState(settings.pushIncludeTranslation !== false);
  const [pushIncludeAiReport, setPushIncludeAiReport] = useState(settings.pushIncludeAiReport !== false);
  const [pushJournalFilter, setPushJournalFilter] = useState(settings.pushJournalFilter || "");
  const [pushSelectedJournals, setPushSelectedJournals] = useState(new Set());
  const [pushSelectedDirections, setPushSelectedDirections] = useState(() => parseDirectionFilter(settings.pushDirectionFilter));
  const [sending, setSending] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushEditing, setPushEditing] = useState(false);
  
  // Cron time selection state
  const [pushHour, setPushHour] = useState("8");
  const [pushMinute, setPushMinute] = useState("0");
  const [pushWeekday, setPushWeekday] = useState("1");
  const [pushMonthDay, setPushMonthDay] = useState("1");
  
  // Generate Cron expression from selections
  function generateCron() {
    const minute = pushMinute || "0";
    const hour = pushHour || "8";
    if (pushFrequency === "daily") return `${minute} hour * * *`.replace("hour", hour);
    if (pushFrequency === "weekly") return `${minute} hour * * ${pushWeekday}`.replace("hour", hour);
    if (pushFrequency === "monthly") return `${minute} hour ${pushMonthDay} * *`.replace("hour", hour);
    return `${minute} hour * * 1`.replace("hour", hour);
  }
  
  // Parse Cron expression to populate selections
  function parseCron(cronStr) {
    const parts = (cronStr || "0 8 * * 1").split(" ");
    if (parts.length >= 5) {
      setPushMinute(parts[0] === "*" ? "0" : parts[0]);
      setPushHour(parts[1] === "*" ? "8" : parts[1]);
      setPushWeekday(parts[4] === "*" ? "1" : parts[4]);
      setPushMonthDay(parts[2] === "*" ? "1" : parts[2]);
    }
  }
  
  // Initialize from settings
  useEffect(() => {
    if (settings.pushCron) parseCron(settings.pushCron);
  }, [settings.pushCron]);

  useEffect(() => {
    setRefreshCron(settings.refreshCron);
    setPushEnabled(settings.pushEnabled || false);
    setPushFrequency(settings.pushFrequency || "weekly");
    setPushCron(settings.pushCron || "0 8 * * 1");
    setPushDays(settings.pushDays || 7);
    setPushIncludeFile(settings.pushIncludeFile !== false);
    setPushIncludeAbstract(settings.pushIncludeAbstract !== false);
    setPushIncludeKeywords(settings.pushIncludeKeywords !== false);
    setPushIncludeTranslation(settings.pushIncludeTranslation !== false);
    setPushIncludeAiReport(settings.pushIncludeAiReport !== false);
    setPushJournalFilter(settings.pushJournalFilter || "");
    setPushSelectedDirections(parseDirectionFilter(settings.pushDirectionFilter));
    // Parse pushJournalFilter to Set for checkbox selection
    if (settings.pushJournalFilter) {
      setPushSelectedJournals(new Set(settings.pushJournalFilter.split(",").map((s) => s.trim()).filter(Boolean)));
    } else {
      setPushSelectedJournals(new Set());
    }
    if (settings.pushCron) parseCron(settings.pushCron);
    // If push is already enabled, start in view mode (not editing)
    if (settings.pushEnabled) {
      setPushEditing(false);
    }
  }, [settings]);

  useEffect(() => {
    api.get("/api/user-email").then((data) => {
      setUserEmail(data.email || "");
      setSavedEmail(data.email || "");
    }).catch(() => {});
  }, []);

  function togglePushJournal(name) {
    const next = new Set(pushSelectedJournals);
    next.has(name) ? next.delete(name) : next.add(name);
    setPushSelectedJournals(next);
    setPushJournalFilter([...next].join(", "));
  }

  function togglePushDirection(key) {
    // 保序切换：新选的方向追加到队尾，取消选择移除，剩余顺序不动——
    // 用户通过重新点击即可调整邮件分组顺序。
    setPushSelectedDirections((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  }

  async function saveEmail() {
    setEmailMsg("");
    try {
      await api.post("/api/user-email", { email: userEmail });
      setSavedEmail(userEmail);
      setEmailMsg("邮箱已保存");
      // 保存成功后回到只读态（需求 2）：需再次点击「修改」才能编辑。
      setEmailEditing(false);
    } catch (e) { setEmailMsg(e.message); }
  }

  async function testEmail() {
    setTesting(true); setTestMsg("");
    try {
      const res = await api.post("/api/test-email");
      setTestMsg(res.sent ? `测试邮件已发送至 ${res.email}` : "发送失败，请检查 SMTP 配置");
    } catch (e) { setTestMsg(e.message); }
    finally { setTesting(false); }
  }

  async function sendPush() {
    setSending(true);
    // 生成摘要要遍历本周期全部论文，几秒内不会有响应；先给出明确反馈，
    // 否则用户点完看不到任何变化，会以为按钮没生效。
    setPushMsg("正在生成摘要并投递邮件，请稍候…（此过程需要几秒）");
    const startedAt = Date.now();
    try {
      const res = await api.post("/api/push/send", undefined, { timeoutMs: 180000 });
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      setPushMsg(res.sent
        ? `推送成功，共 ${res.count} 篇文献（耗时 ${seconds} 秒）`
        : "推送失败，请检查 SMTP 配置");
    } catch (e) {
      setPushMsg(`发送失败：${e.message}`);
    }
    finally { setSending(false); }
  }

  function submit(event) {
    event.preventDefault();
    const generatedCron = generateCron();
    onSave({
      // 订阅期刊入口已移除（需求 9）：文献库展示范围与推送默认范围沿用账户
      // 现有值，不再由该页修改；筛选面板的期刊多选已覆盖按刊查看的需求。
      refreshCron,
      emailEnabled: settings.emailEnabled,
      emailRecipients: settings.emailRecipients,
      pushEnabled,
      pushFrequency,
      pushCron: generatedCron,
      pushDays,
      pushIncludeFile,
      pushIncludeAbstract,
      pushIncludeKeywords,
      pushIncludeTranslation,
      pushIncludeAiReport,
      pushJournalFilter,
      pushDirectionFilter: pushSelectedDirections.join(",")
    });
    setPushCron(generatedCron);
    setPushEditing(false);
  }

  return (
    <div className="settings-view">
      <div className="settings-columns">
        {/* Left Column: Email + Push Settings */}
        <div className="settings-left">
          <section className="settings-section">
            <h4><Mail size={15} /> 我的周报邮箱</h4>
            <p className="section-hint">填写后系统将每周推送最新文献到此邮箱。</p>
            <div className="saved-email-status">
              {savedEmail ? (
                <span>已保存：<strong>{savedEmail}</strong>{emailEditing && userEmail !== savedEmail && <span className="unsaved-hint">（已修改，未保存）</span>}</span>
              ) : (
                <span className="no-email-hint">尚未保存邮箱</span>
              )}
            </div>
            {/* 邮箱 + 测试按钮一行（需求 1）；已保存时输入只读、按钮变「修改」（需求 2） */}
            <div className="email-row">
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={Boolean(savedEmail) && !emailEditing}
              />
              {savedEmail && !emailEditing ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => { setUserEmail(savedEmail); setEmailEditing(true); }}
                >
                  <Pencil size={14} /> 修改
                </button>
              ) : (
                <button className="primary" type="button" onClick={saveEmail}><Save size={14} /> 保存</button>
              )}
              <button className="secondary" type="button" onClick={testEmail} disabled={testing || !savedEmail}>
                <Send size={14} /> {testing ? "发送中..." : "发送测试邮箱"}
              </button>
            </div>
            {emailMsg && <div className="inline-msg">{emailMsg}</div>}
            {testMsg && <div className="inline-msg">{testMsg}</div>}
          </section>

          <form className="settings-section" onSubmit={submit}>
            <h4><Send size={15} /> 文献推送</h4>
            <p className="section-hint">配置自动推送文献到邮箱的设置。</p>
            
            <div className="push-settings">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={(e) => {
                    setPushEnabled(e.target.checked);
                    if (e.target.checked) setPushEditing(true);
                  }}
                />
                启用自动推送
              </label>

              {pushEnabled && !pushEditing && (
                <div className="push-summary">
                  <div className="push-summary-grid">
                    <div className="push-summary-item">
                      <span className="push-summary-label">推送频率</span>
                      <span className="push-summary-value">
                        {pushFrequency === "daily" ? "每天" : pushFrequency === "weekly" ? "每周" : "每月"}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">发送时间</span>
                      <span className="push-summary-value">
                        {pushHour.padStart(2, '0')}:{pushMinute}
                        {pushFrequency === "weekly" && ` 周${["日","一","二","三","四","五","六"][pushWeekday]}`}
                        {pushFrequency === "monthly" && ` 每月${pushMonthDay}日`}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">邮件内容</span>
                      <span className="push-summary-value">
                        {[pushIncludeFile && "附件", pushIncludeAbstract && "摘要", pushIncludeKeywords && "关键词", pushIncludeTranslation && "翻译", pushIncludeAiReport && "AI 速览"].filter(Boolean).join("、")}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">推送期刊</span>
                      <span className="push-summary-value">
                        {pushJournalFilter ? pushSelectedJournals.size + " 本期刊" : "全部已订阅"}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">研究方向</span>
                      <span className="push-summary-value">
                        {pushSelectedDirections.length > 0 ? pushSelectedDirections.length + " 个方向" : "全部方向"}
                      </span>
                    </div>
                  </div>
                  <div className="push-actions">
                    <button className="secondary" type="button" onClick={() => setPushEditing(true)}>
                      <Settings size={16} /> 修改推送设置
                    </button>
                    <button className="secondary" type="button" onClick={sendPush} disabled={sending || !savedEmail}>
                      <Send size={16} /> {sending ? "发送中..." : "立即发送"}
                    </button>
                  </div>
                  {pushMsg && <div className="inline-msg">{pushMsg}</div>}
                </div>
              )}

              {pushEnabled && pushEditing && (
                <>
                  {/* 编辑态两列布局（需求 10）：左列频率/时间/邮件内容，右列
                      期刊范围/方向偏好，一屏看全，少滚动。 */}
                  <div className="push-edit-grid">
                  <div className="push-edit-col">
                  <div className="push-frequency">
                    <span className="settings-label">推送频率</span>
                    <div className="radio-group">
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="daily"
                          checked={pushFrequency === "daily"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每天
                      </label>
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="weekly"
                          checked={pushFrequency === "weekly"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每周
                      </label>
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="monthly"
                          checked={pushFrequency === "monthly"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每月
                      </label>
                    </div>
                  </div>

                  <div className="push-time-selector">
                    <span className="settings-label">发送时间</span>
                    <div className="time-selector-row">
                      <div className="time-select-group">
                        <select value={pushHour} onChange={(e) => setPushHour(e.target.value)}>
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={String(i)}>{String(i).padStart(2, '0')} 时</option>
                          ))}
                        </select>
                        <span className="time-separator">:</span>
                        <select value={pushMinute} onChange={(e) => setPushMinute(e.target.value)}>
                          {["00", "15", "30", "45"].map((m) => (
                            <option key={m} value={m}>{m} 分</option>
                          ))}
                        </select>
                      </div>
                      
                      {pushFrequency === "weekly" && (
                        <div className="time-select-group">
                          <select value={pushWeekday} onChange={(e) => setPushWeekday(e.target.value)}>
                            <option value="1">周一</option>
                            <option value="2">周二</option>
                            <option value="3">周三</option>
                            <option value="4">周四</option>
                            <option value="5">周五</option>
                            <option value="6">周六</option>
                            <option value="0">周日</option>
                          </select>
                        </div>
                      )}
                      
                      {pushFrequency === "monthly" && (
                        <div className="time-select-group">
                          <select value={pushMonthDay} onChange={(e) => setPushMonthDay(e.target.value)}>
                            {Array.from({ length: 28 }, (_, i) => (
                              <option key={i + 1} value={String(i + 1)}>每月 {i + 1} 日</option>
                            ))}
                            <option value="28">每月 28 日</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <p className="field-hint">当前设置：{generateCron()}</p>
                  </div>

                  <div className="push-content-options">
                    <span className="settings-label">邮件内容</span>
                    <div className="checkbox-group">
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeFile}
                          onChange={(e) => setPushIncludeFile(e.target.checked)}
                        />
                        附件文件
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeAbstract}
                          onChange={(e) => setPushIncludeAbstract(e.target.checked)}
                        />
                        摘要
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeKeywords}
                          onChange={(e) => setPushIncludeKeywords(e.target.checked)}
                        />
                        关键词
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeTranslation}
                          onChange={(e) => setPushIncludeTranslation(e.target.checked)}
                        />
                        翻译
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeAiReport}
                          onChange={(e) => setPushIncludeAiReport(e.target.checked)}
                        />
                        AI 研究速览
                      </label>
                    </div>
                    <p className="field-hint">AI 研究速览由智能体每周生成；当期未生成时自动附最近一期并标注期数。</p>
                  </div>

                  {/* 研究方向偏好移到左列（需求 2）：与频率/时间/邮件内容同列，
                      右列留给期刊范围大块，两侧高度与空间利用均衡 */}
                  <div className="push-journal-filter">
                    <span className="settings-label"><Compass size={13} aria-hidden="true" /> 推送研究方向</span>
                    <p className="field-hint">选择推送的研究方向，不选择则推送全部方向；邮件正文按下方选择顺序分组展示（点选先后即顺序，「其他」默认不在推送范围，显式选择后仅推送其他）</p>
                    <div className="keyword-filter-list direction-filter-list push-direction-list">
                      {DIRECTIONS.map((direction) => {
                        const active = pushSelectedDirections.includes(direction.key);
                        const order = pushSelectedDirections.indexOf(direction.key);
                        return (
                          <button
                            key={direction.key}
                            type="button"
                            className={`direction-filter-chip ${active ? "active" : ""}`}
                            style={active ? { "--dir-key": directionVar(direction.key) } : undefined}
                            onClick={() => togglePushDirection(direction.key)}
                            title={direction.key === "other"
                              ? "其他/交叉：默认不进入推送，选择此项可仅推送其他"
                              : directionLabel(direction.key)}
                          >
                            <span className="direction-dot" style={{ "--dir-key": directionVar(direction.key) }} aria-hidden="true" />
                            <span className="kw-name">{directionLabel(direction.key)}</span>
                            {active && <span className="direction-order-badge" aria-hidden="true">{order + 1}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  </div>
                  <div className="push-edit-col">
                  <div className="push-journal-filter">
                    <span className="settings-label">推送期刊范围</span>
                    <p className="field-hint">勾选需要推送的期刊，不勾选则推送全部期刊；按出版社分组，支持组级全选/清除</p>
                    <label className="checkline push-journal-all">
                      <input
                        type="checkbox"
                        checked={pushSelectedJournals.size === 0}
                        onChange={() => {
                          setPushSelectedJournals(new Set());
                          setPushJournalFilter("");
                        }}
                      />
                      全部期刊（不限定）
                    </label>
                    {/* 按出版社分组全量平铺（需求 3）：不再滚动，组级全选/清除与筛选面板一致 */}
                    <div className="push-journal-groups">
                      {pushJournalGroups.map((group) => {
                        const names = group.items.map((j) => j.name);
                        const selected = names.filter((n) => pushSelectedJournals.has(n)).length;
                        const allSelected = names.length > 0 && selected === names.length;
                        const toggleGroup = () => {
                          const next = new Set(pushSelectedJournals);
                          if (allSelected) names.forEach((n) => next.delete(n));
                          else names.forEach((n) => next.add(n));
                          setPushSelectedJournals(next);
                          setPushJournalFilter([...next].join(", "));
                        };
                        return (
                          <div className="push-journal-group" key={group.key}>
                            <div className="push-journal-group-head">
                              <span className={`journal-group-dot tone-${group.key}`} aria-hidden="true" />
                              <span className="push-journal-group-label">{group.label}</span>
                              <span className="push-journal-group-count">{selected}/{names.length}</span>
                              <button type="button" className="link-button" onClick={toggleGroup}>
                                {allSelected ? "清除" : "全选"}
                              </button>
                            </div>
                            <div className="push-journal-chips">
                              {group.items.map((j) => (
                                <button
                                  key={j.name}
                                  type="button"
                                  className={`push-journal-chip tone-${group.key} ${pushSelectedJournals.has(j.name) ? "active" : ""}`}
                                  onClick={() => togglePushJournal(j.name)}
                                  title={j.name}
                                >
                                  {j.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  </div>
                  </div>

                  <div className="push-actions">
                    <button className="primary" type="submit"><Save size={16} /> 保存推送设置</button>
                    <button className="secondary" type="button" onClick={() => setPushEditing(false)}>
                      取消
                    </button>
                    <button className="secondary" type="button" onClick={sendPush} disabled={sending || !savedEmail}>
                      <Send size={16} /> {sending ? "发送中..." : "立即发送"}
                    </button>
                  </div>
                  {pushMsg && <div className="inline-msg">{pushMsg}</div>}
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
