import { useEffect, useMemo, useState } from "react";
import { Filter, Mail, Save, Send, Settings, UserRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { groupJournals } from "../../lib/journal.js";

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

function SettingsEditor({ settings, availableJournals, status, onSave }) {
  const [selectedJournalNames, setSelectedJournalNames] = useState(
    new Set(settings.journals.map((j) => j.name))
  );
  const [refreshCron, setRefreshCron] = useState(settings.refreshCron);
  // Same publisher buckets as the feed filter, so the two lists agree.
  const journalGroups = useMemo(() => groupJournals(availableJournals), [availableJournals]);

  const [userEmail, setUserEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  // Push settings
  const [pushEnabled, setPushEnabled] = useState(settings.pushEnabled || false);
  const [pushFrequency, setPushFrequency] = useState(settings.pushFrequency || "weekly");
  const [pushCron, setPushCron] = useState(settings.pushCron || "0 8 * * 1");
  const [pushDays, setPushDays] = useState(settings.pushDays || 7);
  const [pushIncludeFile, setPushIncludeFile] = useState(settings.pushIncludeFile !== false);
  const [pushIncludeAbstract, setPushIncludeAbstract] = useState(settings.pushIncludeAbstract !== false);
  const [pushIncludeKeywords, setPushIncludeKeywords] = useState(settings.pushIncludeKeywords !== false);
  const [pushIncludeTranslation, setPushIncludeTranslation] = useState(settings.pushIncludeTranslation !== false);
  const [pushJournalFilter, setPushJournalFilter] = useState(settings.pushJournalFilter || "");
  const [pushSelectedJournals, setPushSelectedJournals] = useState(new Set());
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
    setSelectedJournalNames(new Set(settings.journals.map((j) => j.name)));
    setRefreshCron(settings.refreshCron);
    setPushEnabled(settings.pushEnabled || false);
    setPushFrequency(settings.pushFrequency || "weekly");
    setPushCron(settings.pushCron || "0 8 * * 1");
    setPushDays(settings.pushDays || 7);
    setPushIncludeFile(settings.pushIncludeFile !== false);
    setPushIncludeAbstract(settings.pushIncludeAbstract !== false);
    setPushIncludeKeywords(settings.pushIncludeKeywords !== false);
    setPushIncludeTranslation(settings.pushIncludeTranslation !== false);
    setPushJournalFilter(settings.pushJournalFilter || "");
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

  function toggleJournal(name) {
    const next = new Set(selectedJournalNames);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelectedJournalNames(next);
  }

  function togglePushJournal(name) {
    const next = new Set(pushSelectedJournals);
    next.has(name) ? next.delete(name) : next.add(name);
    setPushSelectedJournals(next);
    setPushJournalFilter([...next].join(", "));
  }

  async function saveEmail() {
    setEmailMsg("");
    try {
      await api.post("/api/user-email", { email: userEmail });
      setSavedEmail(userEmail);
      setEmailMsg("邮箱已保存");
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
    setSending(true); setPushMsg("");
    try {
      const res = await api.post("/api/push/send");
      setPushMsg(res.sent ? `推送成功，共 ${res.count} 篇文献` : "推送失败，请检查 SMTP 配置");
    } catch (e) { setPushMsg(e.message); }
    finally { setSending(false); }
  }

  function submit(event) {
    event.preventDefault();
    const journals = availableJournals.filter((j) => selectedJournalNames.has(j.name));
    const generatedCron = generateCron();
    onSave({ 
      journals, 
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
      pushJournalFilter
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
                <span>已保存：<strong>{savedEmail}</strong>{userEmail !== savedEmail && <span className="unsaved-hint">（已修改，未保存）</span>}</span>
              ) : (
                <span className="no-email-hint">尚未保存邮箱</span>
              )}
            </div>
            <div className="email-row">
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="your@email.com"
              />
              <button className="primary" type="button" onClick={saveEmail}><Save size={14} /> 保存</button>
            </div>
            {emailMsg && <div className="inline-msg">{emailMsg}</div>}
            <button className="secondary" type="button" onClick={testEmail} disabled={testing || !savedEmail} style={{ marginTop: 8 }}>
              <Send size={14} /> {testing ? "发送中..." : "发送测试邮箱"}
            </button>
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
                        {[pushIncludeFile && "附件", pushIncludeAbstract && "摘要", pushIncludeKeywords && "关键词", pushIncludeTranslation && "翻译"].filter(Boolean).join("、")}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">推送期刊</span>
                      <span className="push-summary-value">
                        {pushJournalFilter ? pushSelectedJournals.size + " 本期刊" : "全部已订阅"}
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
                    </div>
                  </div>

                  <div className="push-journal-filter">
                    <span className="settings-label">推送期刊范围</span>
                    <p className="field-hint">勾选需要推送的期刊，不勾选则推送所有已订阅期刊</p>
                    <div className="push-journal-list">
                      <label className="checkline push-journal-all">
                        <input
                          type="checkbox"
                          checked={pushSelectedJournals.size === 0}
                          onChange={() => {
                            setPushSelectedJournals(new Set());
                            setPushJournalFilter("");
                          }}
                        />
                        全部已订阅期刊
                      </label>
                      {availableJournals.map((j) => (
                        <label className="checkline" key={j.name}>
                          <input
                            type="checkbox"
                            checked={pushSelectedJournals.has(j.name)}
                            onChange={() => togglePushJournal(j.name)}
                          />
                          {j.name}
                        </label>
                      ))}
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

        {/* Right Column: Journals */}
        <div className="settings-right">
          <form className="settings-section" onSubmit={submit}>
            <h4>订阅期刊</h4>
            <div className="journal-compact-header">
              <span className="section-hint">勾选订阅期刊，最新文献仅展示已订阅的论文。</span>
              <div>
                <button type="button" className="link-button" onClick={() => setSelectedJournalNames(new Set(availableJournals.map((j) => j.name)))}>全选</button>
                <button type="button" className="link-button" onClick={() => setSelectedJournalNames(new Set())}>清空</button>
              </div>
            </div>
            <div className="journal-list-compact">
              {journalGroups.map((group) => (
                <div className="journal-group" key={group.key}>
                  <div className="journal-group-head">
                    <span className={`journal-group-dot tone-${group.key}`} aria-hidden="true" />
                    <span className="journal-group-label">{group.label}</span>
                    <span className="journal-group-count">{group.items.length} 本</span>
                  </div>
                  {group.items.map((j) => (
                    <label className="journal-item" key={j.name}>
                      <input type="checkbox" checked={selectedJournalNames.has(j.name)} onChange={() => toggleJournal(j.name)} />
                      <span>{j.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="settings-actions">
              <button className="primary" type="submit"><Save size={16} /> 保存设置</button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}

export default SettingsView;
