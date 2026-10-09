import Button from "../components/ui/Button";
import { Component } from 'react';
import { Link } from 'react-router-dom';
import { recoverStaleAssetError } from '../utils/staleAssetRecovery.js';

export default class RouteErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) {
    recoverStaleAssetError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="lmc-route-state" role="alert">
      <h1>Let’s try that again</h1>
      <p>This page couldn’t load. Check your connection, then reload.</p>
      <div className="lmc-route-actions">
        <Button type="button" onClick={() => window.location.reload()}>Reload page</Button>
        <Link to="/recipes">Browse recipes</Link>
      </div>
    </main>;
  }
}
