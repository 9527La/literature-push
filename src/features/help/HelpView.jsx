import { BarChart3, Bell, HelpCircle, Keyboard, Mail, RefreshCw, Star, UserRound } from "lucide-react";
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
        <h3><Bell size={18} /> 最新文献</h3>
        <p>展示已订阅期刊的最新论文。页面会优先显示本地已有内容，缺失的摘要、关键词和中文翻译在后台补全。</p>
        <ul>
          <li><strong>搜索与筛选</strong>：点击“打开筛选”后，可按标题、作者、摘要、关键词、期刊、日期、未读状态和收藏状态筛选；同一条件内的多选为“或”关系，不同条件之间为“且”关系。</li>
          <li><strong>排序</strong>：支持最新优先、最早优先和按相关性排序。相关性按标题、关键词和摘要中的匹配程度计算。</li>
          <li><strong>阅读操作</strong>：点击标题或摘要图标查看文献详情；使用勾选按钮标记或取消已读，使用心形按钮收藏或取消收藏。</li>
          <li><strong>显示控制</strong>：顶部“显示内容”开关可分别控制作者、关键词、摘要、中文标题和中文摘要；中文摘要默认关闭，中文期刊不会重复显示中文摘要。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><Keyboard size={18} /> 键盘快捷键</h3>
        <p>“最新文献”页支持纯键盘浏览：先按 J 或 ↓ 选中一篇文献，再执行阅读或收藏操作。焦点在输入框中时不会触发快捷键。</p>
        <ul>
          <li><strong>J / ↓</strong> 选中下一篇，<strong>K / ↑</strong> 选中上一篇，选中项左侧边框高亮。</li>
          <li><strong>Enter</strong> 打开选中文献详情，<strong>Esc</strong> 取消选中（或关闭已打开的弹窗）。</li>
          <li><strong>R</strong> 标记已读 / 取消已读，<strong>F</strong> 收藏 / 取消收藏。</li>
          <li><strong>/</strong> 展开筛选面板并聚焦搜索框。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><Star size={18} /> 收藏文献</h3>
        <p>把重要文献集中保存，按研究方向管理，并为每篇文献记录自己的备注。</p>
        <ul>
          <li><strong>默认收藏夹</strong>：新注册的个人账户会自动创建“默认收藏夹”，首次收藏时会优先选中它。</li>
          <li><strong>分组管理</strong>：可以新建、重命名或删除分组；删除分组不会删除其中的文献，文献会转为“未分组”。</li>
          <li><strong>备注与调整</strong>：在收藏列表中可修改文献分组和备注，点击“保存备注”后生效。</li>
          <li><strong>账户隔离</strong>：收藏、阅读状态、分组和备注只属于当前个人账户，游客不能保存这些内容。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><BarChart3 size={18} /> 关键词统计</h3>
        <p>汇总文献关键词及其频次，帮助了解研究热点和关键词之间的共现关系。</p>
        <ul>
          <li>可按期刊和时间范围重新统计。</li>
          <li>支持列表、词云和共现三种查看方式，可搜索关键词。</li>
          <li>点击关键词后可查看对应文献，并进一步打开文献详情。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><Mail size={18} /> 文献推送</h3>
        <p>在“文献推送”页面管理邮箱、订阅期刊和自动推送计划。</p>
        <ul>
          <li><strong>邮箱</strong>：填写并保存邮箱后，可以发送测试邮件。</li>
          <li><strong>订阅期刊</strong>：勾选需要关注的期刊，最新文献和推送会使用账户自己的订阅范围。</li>
          <li><strong>推送计划</strong>：支持每天、每周或每月推送，可设置发送时间、邮件内容和推送期刊范围。</li>
          <li>游客可以浏览设置页面，但需要登录个人账户才能保存邮箱、期刊和推送配置。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><UserRound size={18} /> 账户与个性设置</h3>
        <ul>
          <li><strong>网页通行证</strong>：用于进入网页；它与个人账户相互独立。</li>
          <li><strong>个人账户</strong>：可注册、登录和退出。登录后才能保存阅读、收藏、推送和讨论相关数据。</li>
          <li><strong>本机保存</strong>：可以将筛选、列表显示、订阅期刊和推送配置保存到当前浏览器。</li>
          <li><strong>远端同步</strong>：登录后可手动上传当前个性设置，也可从账户载入已保存设置。</li>
          <li><strong>公共讨论</strong>：登录后可设置发言名称、发布主题、评论和点赞；公开标签按账户固定。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><RefreshCw size={18} /> 数据刷新</h3>
        <p>系统支持后台定时刷新和管理员手动维护。</p>
        <ul>
          <li><strong>定时刷新</strong>：系统按服务器配置的计划获取新文献。</li>
          <li><strong>手动维护</strong>：管理员可在“管理中心”拉取最新文献、补全摘要和关键词，或批量翻译缺失内容。</li>
          <li>刷新期间已有内容仍可浏览；页面会显示后台补全进度和失败提示。</li>
        </ul>
      </section>

      <section className="help-section help-section-wide">
        <h3><HelpCircle size={18} /> 常见问题</h3>
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
