import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="empty-state app-recovery" role="alert">
        <h1>工作区暂时无法显示</h1>
        <p>已保存的任务仍在本机。重新打开页面可恢复工作区。</p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          重新打开工作区
        </button>
      </main>
    );
  }
}
