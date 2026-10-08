import { Component } from "react";
import { hasLiveSession, silentRefresh } from "./lib/session.js";

import "./app.scss";

class App extends Component {
  componentDidMount() {
    // 冷启动：有保存的凭据则尽力静默续登（失败不打扰，页面内 401 会兜底跳登录页）。
    if (!hasLiveSession()) {
      silentRefresh().catch(() => {});
    }
  }

  render() {
    return this.props.children;
  }
}

export default App;
