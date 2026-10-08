export default {
  pages: [
    "pages/feed/index",
    "pages/report/index",
    "pages/news/index",
    "pages/favorites/index",
    "pages/mine/index",
    "pages/login/index",
    "pages/article/index",
    "pages/report-detail/index",
    "pages/news-detail/index",
    "pages/settings/index",
    "pages/feedback/index",
    "pages/help/index"
  ],
  window: {
    navigationBarBackgroundColor: "#f5f6f8",
    navigationBarTitleText: "电力文献",
    navigationBarTextStyle: "black",
    backgroundColor: "#f5f6f8",
    backgroundTextStyle: "light"
  },
  tabBar: {
    color: "#6b7280",
    selectedColor: "#3157d5",
    backgroundColor: "#ffffff",
    borderStyle: "black",
    list: [
      { pagePath: "pages/feed/index", text: "最新文献", iconPath: "assets/tab/feed.png", selectedIconPath: "assets/tab/feed-active.png" },
      { pagePath: "pages/report/index", text: "研究速览", iconPath: "assets/tab/report.png", selectedIconPath: "assets/tab/report-active.png" },
      { pagePath: "pages/news/index", text: "每日资讯", iconPath: "assets/tab/news.png", selectedIconPath: "assets/tab/news-active.png" },
      { pagePath: "pages/favorites/index", text: "收藏", iconPath: "assets/tab/fav.png", selectedIconPath: "assets/tab/fav-active.png" },
      { pagePath: "pages/mine/index", text: "我的", iconPath: "assets/tab/mine.png", selectedIconPath: "assets/tab/mine-active.png" }
    ]
  },
  lazyCodeLoading: "requiredComponents"
}
