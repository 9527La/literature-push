import { useState } from "react";
import { View, Text, Input, Picker, Switch, ScrollView } from "@tarojs/components";
import { PUBLISHER_GROUPS, journalGroup, journalGroupLabel } from "../lib/journal.js";
import { DIRECTIONS, directionLabel } from "../lib/directions.js";
import { DEFAULT_FILTERS, DEFAULT_DISPLAY } from "../lib/constants.js";

/**
 * 半屏筛选弹层（网站左侧筛选栏的移动端形态）。
 * 组：搜索词 / 期刊（按 4 组分组多选）/ 方向多选 / 关键词 / 日期区间 /
 * 排序 / 未读 / 显示设置（authors/keywords/abstract/bilingual/translatedAbstract）。
 */
export default function FilterSheet({ open, journals, directionCounts, filters, displayPrefs, onClose, onApply, onDisplayPrefsChange }) {
  const [draft, setDraft] = useState(filters);
  const [searchInput, setSearchInput] = useState(filters.q);

  const activeCount = [
    draft.journal.length, draft.direction.length, draft.keyword.length,
    draft.q ? 1 : 0, draft.unread ? 1 : 0, draft.favorite ? 1 : 0,
    draft.from ? 1 : 0, draft.to ? 1 : 0, draft.sort !== DEFAULT_FILTERS.sort ? 1 : 0
  ].reduce((sum, value) => sum + (value ? 1 : 0), 0);

  const toggleIn = (list, value) => (
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  );

  const apply = () => {
    onApply({ ...draft, q: searchInput.trim() });
  };

  const reset = () => {
    setDraft({ ...DEFAULT_FILTERS });
    setSearchInput("");
  };

  const renderJournalGroup = (groupKey) => {
    const items = (Array.isArray(journals) ? journals : []).filter((journal) => journalGroup(journal) === groupKey);
    if (!items.length) return null;
    return (
      <View className="sheet-group" key={groupKey}>
        <View className="sheet-group-label">{journalGroupLabel(groupKey)}</View>
        <View className="row wrap">
          {items.map((journal) => (
            <Text
              key={journal.name}
              className={`chip${draft.journal.includes(journal.name) ? " active" : ""}`}
              onClick={() => setDraft({ ...draft, journal: toggleIn(draft.journal, journal.name) })}
            >
              {journal.name}
            </Text>
          ))}
        </View>
      </View>
    );
  };

  const countOf = (key) => {
    const hit = (directionCounts || []).find((item) => (item.key || item.direction) === key);
    return hit ? Number(hit.count ?? hit.total ?? 0) : 0;
  };

  return (
    <View>
      <View className="sheet-mask" onClick={onClose} />
      <View className="sheet">
        <View className="sheet-title">筛选{activeCount ? `（${activeCount} 项生效）` : ""}</View>

        <View className="sheet-group">
          <View className="sheet-group-label">搜索标题 / 作者 / 关键词</View>
          <Input className="input" value={searchInput} placeholder="输入关键词" onInput={(event) => setSearchInput(event.detail.value)} />
        </View>

        {PUBLISHER_GROUPS.map((group) => renderJournalGroup(group.key))}

        <View className="sheet-group">
          <View className="sheet-group-label">AI 研究方向（多选，other 默认不出现在列表）</View>
          <View className="row wrap">
            {DIRECTIONS.filter((direction) => direction.key !== "other" || draft.direction.includes("other")).map((direction) => (
              <Text
                key={direction.key}
                className={`chip${draft.direction.includes(direction.key) ? " active" : ""}`}
                onClick={() => setDraft({ ...draft, direction: toggleIn(draft.direction, direction.key) })}
              >
                {directionLabel(direction.key)}{countOf(direction.key) ? ` ${countOf(direction.key)}` : ""}
              </Text>
            ))}
          </View>
        </View>

        <View className="sheet-group">
          <View className="sheet-group-label">关键词（逗号分隔，命中任一）</View>
          <Input
            className="input"
            value={draft.keyword.join(",")}
            placeholder="如：虚拟电厂,灵活性"
            onInput={(event) => setDraft({ ...draft, keyword: String(event.detail.value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean) })}
          />
        </View>

        <View className="sheet-group">
          <View className="sheet-group-label">日期区间（display_date 口径）</View>
          <View className="row" style={{ gap: "8px" }}>
            <Picker mode="date" value={draft.from} onConfirm={(event) => setDraft({ ...draft, from: event.detail.value })} className="grow">
              <View className="input">{draft.from || "开始日期"}</View>
            </Picker>
            <Picker mode="date" value={draft.to} onConfirm={(event) => setDraft({ ...draft, to: event.detail.value })} className="grow">
              <View className="input">{draft.to || "结束日期"}</View>
            </Picker>
          </View>
        </View>

        <View className="cell">
          <Text className="cell-label">排序：新→旧</Text>
          <Switch checked={draft.sort === "asc"} onChange={(event) => setDraft({ ...draft, sort: event.detail.value ? "asc" : "desc" })} />
        </View>
        <View className="cell">
          <Text className="cell-label">仅看未读</Text>
          <Switch checked={draft.unread} onChange={(event) => setDraft({ ...draft, unread: event.detail.value })} />
        </View>

        <View className="sheet-group mt8">
          <View className="sheet-group-label">显示设置（全局生效）</View>
          {[
            ["authors", "显示作者"],
            ["keywords", "显示关键词"],
            ["abstract", "显示摘要"],
            ["bilingual", "显示中文标题（有翻译时）"],
            ["translatedAbstract", "显示中文摘要（非中文刊）"]
          ].map(([field, label]) => (
            <View className="cell" key={field}>
              <Text className="cell-label">{label}</Text>
              <Switch
                checked={Boolean(displayPrefs?.[field])}
                onChange={(event) => onDisplayPrefsChange({ ...DEFAULT_DISPLAY, ...displayPrefs, [field]: event.detail.value })}
              />
            </View>
          ))}
        </View>

        <View className="sheet-foot">
          <Text className="btn btn-ghost" onClick={reset}>重置</Text>
          <Text className="btn btn-primary" onClick={apply}>应用筛选</Text>
        </View>
      </View>
    </View>
  );
}

/** 期刊组快速 chips（横向滚动条）：点按 = 整组开/关。 */
export function JournalGroupChips({ journals, filters, onToggleGroup }) {
  return (
    <ScrollView scrollX className="hscroll" enhanced showScrollbar={false}>
      <View className="chip-row" style={{ padding: "0 2px" }}>
        {PUBLISHER_GROUPS.map((group) => {
          const names = (journals || []).filter((journal) => journalGroup(journal) === group.key).map((journal) => journal.name);
          if (!names.length) return null;
          const allSelected = names.every((name) => filters.journal.includes(name));
          return (
            <Text
              key={group.key}
              className={`chip hscroll-item${allSelected ? " active" : ""}`}
              onClick={() => onToggleGroup(group.key, names, allSelected)}
            >
              <Text className="chip-dot" style={{ background: `var(--tone-${group.key})` }} />
              {journalGroupLabel(group.key)}·{names.length}
            </Text>
          );
        })}
      </View>
    </ScrollView>
  );
}
