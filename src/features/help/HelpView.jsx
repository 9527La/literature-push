import { BarChart3, BookOpenCheck, HelpCircle, Library, Mail, Newspaper, RefreshCw, Sparkles, Star, UserRound } from "lucide-react";
import InternalUseNotice from "../../components/InternalUseNotice.jsx";


function HelpView() {
  return (
    <div className="help-view" aria-labelledby="help-title">
      <section className="help-section help-intro help-section-wide">
        <div className="help-intro-copy">
          <span className="eyebrow">快速上手</span>
          <h1 id="help-title">使用说明</h1>
          <p>本系统面向课题组内部的电力系统文献阅读与整理，提供文献浏览、关键词统计、收藏管理、邮件推送、公共讨论和个性设置同步。</p>
        </div>
        <InternalUseNotice compact />
      </section>

      <section className="help-section">
        <h2><Library size={18} /> 文献库</h2>
        <p>展示站点收录期刊的最新论文。摘要、关键词与中文翻译由管理员统一维护入库，打开即可直接阅读。</p>
        <ul>
          <li><strong>搜索与筛选</strong>：筛选面板默认收起，点击“打开筛选”展开后，可按标题、作者、摘要、关键词、期刊、研究方向、日期、未读状态和收藏状态筛选（面板内各分组默认收起，点击组名展开）；同一条件内的多选为“或”关系，不同条件之间为“且”关系。</li>
          <li><strong>筛选管理</strong>：每个筛选分组右上角有独立的“清除”按钮；面板顶部提供“清除全部筛选”，一键回到初始状态。期刊分组（IEEE / 爱思唯尔 / 中文期刊）可点击组名展开或收起。</li>
          <li><strong>AI 研究方向</strong>：每篇文献由 AI 自动标注研究方向（卡片上的彩色标签），可按方向多选筛选；“其他/交叉”类文献不进入文献库列表。筛选为空时表示全部分向。</li>
          <li><strong>排序</strong>：支持最新优先、最早优先和按相关性排序。相关性按标题、关键词和摘要中的匹配程度计算。</li>
          <li><strong>阅读操作</strong>：点击标题或摘要图标查看文献详情；使用勾选按钮标记或取消已读，使用心形按钮收藏或取消收藏。</li>
          <li><strong>详情弹窗</strong>：底部自动列出 3 篇“相关文献”（同研究方向、关键词相近），点击可直接切换查看；顶部引用按钮可一键复制 GB/T 7714 格式的引用条目，DOI 也可单独复制。</li>
          <li><strong>显示控制</strong>：顶部“显示内容”开关可分别控制作者、关键词、摘要、中文标题和中文摘要；中文摘要默认关闭，中文期刊不会重复显示中文摘要。</li>
          <li><strong>快捷筛选</strong>：工具栏右侧提供「时间范围」（近 7 日 / 近 30 日 / 本月）与「阅读状态」（全部 / 未读 / 已读），与筛选面板联动，一键收窄列表；已生效的条件会在列表上方以摘要条提示，可一键清除。</li>
          <li><strong>卡片阅读</strong>：工具栏「打开筛选」右侧的“卡片阅读”按钮，可按范围逐条翻阅文献（详见下方“卡片阅读”一节）。</li>
          <li><strong>批量与导出</strong>：勾选多篇文献后可批量标记已读、批量收藏，或导出 RIS / BibTeX 文件。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><Sparkles size={18} /> 研究速览</h2>
        <p>AI 每周生成的文献速报：总览各方向本期动态，并为主要研究方向各生成一份方向专报。</p>
        <ul>
          <li><strong>总览与专报</strong>：总览按方向分组展示本期文献与速评；点击方向 chips 或分组可查看该方向的完整专报与全部文献。</li>
          <li><strong>三段式速评</strong>：每篇精选文献附“研究对象 / 研究方法 / 核心结论”速评，点击速评行可直接打开对应文献。</li>
          <li><strong>主题聚类（专题）</strong>：月度方向专报按主题聚类组织，聚类头可展开 / 收起，聚类内速评卡默认先显示一行，点“继续加载全部”查看其余条目。</li>
          <li><strong>卡片阅读入口</strong>：每个方向分组底部、方向专报信息条右侧、以及每个主题聚类底部都有“卡片阅读 · N 篇”，按该范围逐条阅读。</li>
          <li><strong>来源期刊筛选</strong>：方向专报信息条中的期刊 chips 可点选隐藏 / 显示该来源的速评卡（仅影响当前报告的浏览，不改变数据）。</li>
          <li><strong>历史回看</strong>：可在“一周速览 / 月度趋势”之间切换，并选择往期期次，观察各方向的热度变化。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><BookOpenCheck size={18} /> 卡片阅读</h2>
        <p>把一批文献变成“一张张卡片”，逐条快速翻阅，免去反复开关详情弹窗；阅读中即可收藏、标记已读、记备注、复制引用。</p>
        <ul>
          <li><strong>进入方式</strong>：① 文献库工具栏“卡片阅读”按钮；② 研究速览的方向分组底部 / 方向专报 / 主题聚类底部的“卡片阅读 · N 篇”。</li>
          <li><strong>选择范围</strong>：进入后先选范围——<em>按速览期</em>（周报 / 月报 → 期次 → 研究方向 → 专题·主题聚类）或 <em>自定义筛选</em>（来源期刊 / 研究方向 / 时间范围 / 阅读状态 / 排序 / 数量上限：50·100·200·自定义·无上限）。</li>
          <li><strong>目录确认</strong>：生成“文献目录”预览清单，确认无误后点“开始卡片阅读”；阅读中可随时“返回调整”重新选范围。</li>
          <li><strong>三种卡片版本</strong>：速评版（研究对象 / 研究方法 / 核心结论）、中文摘要版（完整中文摘要，可展开英文原文对照）、原文版（作者 + 英文摘要）；顶栏或键盘 1 / 2 / 3 切换，默认版本会自动记忆。摘要与原文版为宽幅卡片，长摘要一屏可见。</li>
          <li><strong>翻页与进度</strong>：← → 或空格翻页；顶部进度条可点击 / 拖动跳转到任意位置；右侧显示“第 N / M 条”。</li>
          <li><strong>读即标记与跳过已读</strong>：默认开启“读即标记”（向下翻页时自动把新条目标为已读），可随时关闭；“跳过已读”开启后翻页自动跳过已读文献。</li>
          <li><strong>断点续读</strong>：同一范围再次打开时，自动回到上次读到的位置并提示。</li>
          <li><strong>目录抽屉</strong>：顶栏列表按钮或按 D 打开——查看全批清单、点击序号直达，并可在阅读中改范围（仅未读 / 仅有速评 / 按期刊筛选）；底部提供“读完本批”，一键把本批剩余未读标记为已读（需二次确认）。</li>
          <li><strong>相关文献</strong>：卡片底部列出 3 篇相关文献，点击即可跳转；若不在本批，会自动接在当前条之后，形成连续阅读链。</li>
          <li><strong>卡片内操作</strong>：收藏（F）、标记已读（R）、复制 GB/T 7714 引用（C）、添加备注（N，保存到收藏备注，未收藏时会先自动收藏）；Esc 退出。</li>
          <li><strong>分享直达</strong>：文献库卡片阅读会写入地址 <code>#feed?reader=1</code>，可加入书签或分享给他人直接进入。</li>
          <li>速评版内容来自每周 AI 速评；未被速评覆盖的文献会提示切换到中文摘要版查看完整摘要。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><Newspaper size={18} /> 每日资讯</h2>
        <p>每天自动汇总前一天的政策、标准与重点新闻，左侧为日期列表，右侧为当日内容。</p>
        <ul>
          <li><strong>日期筛选</strong>：点击左栏「筛选日期」展开筛选框，自主选择开始 / 结束年月日（或只填一端），日期列表即时按范围过滤，可一键清除。</li>
          <li><strong>分类筛选</strong>：正文顶部可按“政策标准 / 重点新闻”分类筛选，分类计数一目了然。</li>
          <li><strong>内容查找</strong>：查找框可匹配当日资讯的标题与正文，配合分类筛选即可锁定目标条目。</li>
          <li><strong>概览跳转</strong>：点击“今日导读”中的任意条目可滚动定位到对应详情。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><Star size={18} /> 收藏文献</h2>
        <p>把重要文献集中保存，按研究方向管理，并为每篇文献记录自己的备注。</p>
        <ul>
          <li><strong>收藏分组</strong>：收藏时可选择存入哪个分组，并勾选“设为默认分组”（下次收藏自动预选）；未加入任何分组的文献统一显示在“未分组”，它只是虚拟分类，不占用真实分组。</li>
          <li><strong>分组管理</strong>：可以新建、重命名或删除分组；删除分组不会删除其中的文献，文献会转为“未分组”。</li>
          <li><strong>备注与调整</strong>：在收藏列表中可修改文献分组和备注，点击“保存备注”后生效；备注默认折叠为一行预览，点击展开编辑。卡片阅读中记录的备注也会同步到这里。</li>
          <li><strong>轻筛选与排序</strong>：顶部工具条可按来源期刊、研究方向筛选，并切换排序（最近收藏 / 出版日期），显示“显示 N / 共 M 篇”，可一键“全部显示”。</li>
          <li><strong>账户隔离</strong>：收藏、阅读状态、分组和备注只属于当前个人账户，游客不能保存这些内容。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><BarChart3 size={18} /> 关键词统计</h2>
        <p>汇总文献关键词及其频次，帮助了解研究热点和关键词之间的共现关系。</p>
        <ul>
          <li>可按期刊和时间范围重新统计。</li>
          <li>支持列表、词云和共现三种查看方式，可搜索关键词。</li>
          <li>点击关键词后可查看对应文献，并进一步打开文献详情。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><Mail size={18} /> 文献推送</h2>
        <p>在“文献推送”页面管理邮箱、推送计划和推送范围。</p>
        <ul>
          <li><strong>邮箱</strong>：填写并保存邮箱后，可以发送测试邮件。</li>
          <li><strong>推送计划</strong>：支持每天、每周或每月推送，可设置发送时间、邮件内容和推送期刊范围。</li>
          <li><strong>研究方向偏好</strong>：可只推送选定的研究方向；邮件正文按方向分组展示，分组顺序与设置页点选顺序一致（方向 chips 上有顺序编号）。</li>
          <li><strong>微信公众号</strong>：除邮件外，站点内容同步通过微信公众号“电气前沿速递”每日推送（关注后即可接收）。</li>
          <li>游客可以浏览设置页面，但需要登录个人账户才能保存邮箱、期刊和推送配置。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><UserRound size={18} /> 账户与个性设置</h2>
        <ul>
          <li><strong>网页通行证</strong>：用于进入网页；它与个人账户相互独立。</li>
          <li><strong>个人账户</strong>：可注册、登录和退出。登录后才能保存阅读、收藏、推送和讨论相关数据。</li>
          <li><strong>本机保存</strong>：可以将筛选条件、列表显示和推送配置保存到当前浏览器。</li>
          <li><strong>远端同步</strong>：登录后可手动上传当前个性设置，也可从账户载入已保存设置。</li>
          <li><strong>公共讨论</strong>：登录后可设置发言名称、发布主题、评论和点赞；公开标签按账户固定。</li>
        </ul>
      </section>

      <section className="help-section">
        <h2><RefreshCw size={18} /> 数据刷新</h2>
        <p>系统支持后台定时刷新和管理员手动维护。</p>
        <ul>
          <li><strong>定时刷新</strong>：系统按服务器配置的计划获取新文献。</li>
          <li><strong>手动维护</strong>：管理员可在“管理中心”拉取最新文献、补全摘要和关键词，或批量翻译缺失内容。</li>
          <li>刷新与维护期间已有内容仍可正常浏览。</li>
        </ul>
      </section>

      <section className="help-section help-section-wide">
        <h2><HelpCircle size={18} /> 常见问题</h2>
        <ul>
          <li><strong>局域网访问</strong>：同一 Wi-Fi 下的其他设备可通过浏览器输入本机显示的局域网地址访问本系统。</li>
          <li><strong>版本更新</strong>：系统更新后会弹出更新说明，可选择“知道了”关闭；同一版本不会重复提示。</li>
          <li><strong>管理中心</strong>：只有管理员网页通行证可查看网站统计、用户、期刊完整度和刷新记录，并执行数据维护。</li>
          <li><strong>访问限制</strong>：本项目只限于课题组内部使用，请勿外传，请勿用于商业用途。</li>
        </ul>
      </section>
    </div>
  );
}

export default HelpView;
