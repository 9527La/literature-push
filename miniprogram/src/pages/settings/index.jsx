import { useEffect, useMemo, useState } from "react";
import { View, Text, Input, Switch, Picker } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { PUBLISHER_GROUPS, groupJournals, journalGroupLabel } from "../../lib/journal.js";
import { SkeletonList } from "../../components/States.jsx";

/**
 * 文献推送设置：期刊订阅（按 4 组分组开关）、推送开关/频率、推送邮箱。
 * 保存走 PUT /api/settings（journals 传全量设置对象，未列出的字段原样回传）。
 * 订阅消息提醒为 M3 预留：模板 ID 配置后开启 requestSubscribeMessage。
 */
const FREQUENCIES = [
  { key: "daily", label: "每天" },
  { key: "weekly", label: "每周" },
  { key: "monthly", label: "每月" }
];

function generateCron(frequency, hour, minute, weekday, monthDay) {
  if (frequency === "daily") return `${minute} ${hour} * * *`;
  if (frequency === "weekly") return `${minute} ${hour} * * ${weekday}`;
  if (frequency === "monthly") return `${minute} ${hour} ${monthDay} * *`;
  return `${minute} ${hour} * * 1`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [availableJournals, setAvailableJournals] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushFrequency, setPushFrequency] = useState("weekly");
  const [pushHour, setPushHour] = useState("8");
  const [pushMinute, setPushMinute] = useState("0");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/api/settings"),
      api.get("/api/journals"),
      api.get("/api/user-email").catch(() => ({ email: "" }))
    ]).then(([settingsData, journalsData, emailData]) => {
      setSettings(settingsData);
      setAvailableJournals(Array.isArray(journalsData) ? journalsData : []);
      setSelected(new Set((settingsData.journals || []).map((journal) => journal.name)));
      setPushEnabled(Boolean(settingsData.pushEnabled));
      setPushFrequency(settingsData.pushFrequency || "weekly");
      const cronParts = String(settingsData.pushCron || "0 8 * * 1").split(" ");
      if (cronParts.length >= 5) {
        setPushMinute(cronParts[0] === "*" ? "0" : cronParts[0]);
        setPushHour(cronParts[1] === "*" ? "8" : cronParts[1]);
      }
      setEmail(emailData?.email || "");
    }).catch((error) => Taro.showToast({ title: error.message, icon: "none" }))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => groupJournals(availableJournals), [availableJournals]);

  function toggleJournal(name, value) {
    setSelected((current) => {
      const next = new Set(current);
      if (value) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  async function saveJournals() {
    if (!settings) return;
    setSaving(true);
    try {
      const journals = Array.from(selected).map((name) => ({ name }));
      const next = await api.put("/api/settings", { ...settings, journals });
      setSettings(next);
      Taro.showToast({ title: "订阅已保存", icon: "none" });
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    } finally {
      setSaving(false);
    }
  }

  async function savePush() {
    if (!settings) return;
    setSaving(true);
    try {
      const pushCron = generateCron(pushFrequency, pushHour, pushMinute, "1", "1");
      const next = await api.put("/api/settings", { ...settings, pushEnabled, pushFrequency, pushCron });
      setSettings(next);
      Taro.showToast({ title: "推送计划已保存", icon: "none" });
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    } finally {
      setSaving(false);
    }
  }

  async function saveEmail() {
    try {
      await api.post("/api/user-email", { email: email.trim() });
      Taro.showToast({ title: "推送邮箱已保存", icon: "none" });
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function requestSubscribe() {
    // M3 预留：模板 ID 在微信公众平台申请后填入。
    Taro.showToast({ title: "订阅消息提醒即将上线", icon: "none" });
  }

  if (loading) return <View className="page-body"><SkeletonList count={4} /></View>;
  if (!settings) return <View className="page-body"><Text className="muted">设置加载失败，请返回重试。</Text></View>;

  return (
    <View className="page-body">
      {PUBLISHER_GROUPS.map((group) => {
        const groupData = grouped.find((item) => item.key === group.key);
        if (!groupData || !groupData.items.length) return null;
        return (
          <View className="card" key={group.key}>
            <View className="sheet-group-label">{journalGroupLabel(group.key)}</View>
            {groupData.items.map((journal) => (
              <View className="cell" key={journal.name}>
                <Text className="cell-label">{journal.name}</Text>
                <Switch checked={selected.has(journal.name)} onChange={(event) => toggleJournal(journal.name, event.detail.value)} />
              </View>
            ))}
          </View>
        );
      })}
      <Text className={`btn btn-primary btn-block${saving ? "" : ""}`} onClick={saveJournals} disabled={saving}>保存期刊订阅（{selected.size} 本）</Text>

      <View className="card mt12">
        <View className="sheet-group-label">邮件推送计划</View>
        <View className="cell">
          <Text className="cell-label">启用推送</Text>
          <Switch checked={pushEnabled} onChange={(event) => setPushEnabled(event.detail.value)} />
        </View>
        <View className="cell">
          <Text className="cell-label">推送频率</Text>
          <Picker
            mode="selector"
            range={FREQUENCIES.map((item) => item.label)}
            onChange={(event) => setPushFrequency(FREQUENCIES[Number(event.detail.value)].key)}
          >
            <Text className="chip">{FREQUENCIES.find((item) => item.key === pushFrequency)?.label || "每周"}</Text>
          </Picker>
        </View>
        <View className="cell cell-last">
          <Text className="cell-label">推送时刻（时:点 24h 制）</Text>
          <Picker mode="selector" range={Array.from({ length: 24 }, (_, index) => `${index} 点`)} onChange={(event) => setPushHour(String(Number(event.detail.value)))}>
            <Text className="chip">{pushHour} 点</Text>
          </Picker>
        </View>
        <Text className="btn btn-primary btn-block mt8" onClick={savePush} disabled={saving}>保存推送计划</Text>
      </View>

      <View className="card">
        <View className="sheet-group-label">推送邮箱</View>
        <Input className="input" value={email} placeholder="name@example.com" onInput={(event) => setEmail(event.detail.value)} />
        <Text className="btn btn-block mt8" onClick={saveEmail}>保存邮箱</Text>
        <Text className="btn btn-ghost btn-block mt8" onClick={requestSubscribe}>开启微信订阅消息提醒（即将上线）</Text>
      </View>
    </View>
  );
}
