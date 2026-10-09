import { createApp, type App as VueApp } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import { applyTheme, createLightThemePreference, type ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import App from './App.vue';
import PoliciesView from './views/PoliciesView.vue';
import PolicyEditorView from './views/PolicyEditorView.vue';
import TypedPoliciesView from './views/TypedPoliciesView.vue';
import TypedPolicyEditorView from './views/TypedPolicyEditorView.vue';
import OAuthCallbackView from './views/OAuthCallbackView.vue';
import { configurePolicyApi } from './api/policies';
import { applyPortalIdentity, releasePortalIdentity, type PortalUser } from './state';
import { scheduleLimiterTokenRenewal } from './auth/pkce';
import './style.css';

interface MountProps {
  container?: Element | Document;
  routePrefix?: string;
  apiBase?: string;
  currentUser?: PortalUser | null;
  getCurrentUser?: () => PortalUser | null;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void };
}
let app: VueApp<Element> | null = null;
let router: Router | null = null;
let root: HTMLElement | null = null;
let releaseTheme = () => undefined as void;
let currentProps: MountProps = {};

function update(props: MountProps): void {
  currentProps = { ...currentProps, ...props };
  applyPortalIdentity(currentProps.getCurrentUser ? currentProps.getCurrentUser() : currentProps.currentUser);
  if (props.apiBase !== undefined) configurePolicyApi(props.apiBase, () => router?.currentRoute.value.fullPath ?? '/policies');
  releaseTheme();
  releaseTheme = () => undefined;
  if (root) {
    applyTheme(root, currentProps.theme?.current() ?? createLightThemePreference());
    if (currentProps.theme) releaseTheme = currentProps.theme.subscribe(snapshot => { if (root) applyTheme(root, snapshot); });
  }
}
function unmount(): void {
  releaseTheme();
  releaseTheme = () => undefined;
  releasePortalIdentity();
  app?.unmount();
  app = null;
  router = null;
  root = null;
  currentProps = {};
}
function mount(props: MountProps = {}): void {
  if (app) unmount();
  currentProps = props;
  const prefix = (props.routePrefix ?? '/app/limiter-management').replace(/\/$/, '');
  if (!/^\/(?!\/)[^?#\\]*$/.test(prefix)) throw new Error('页面挂载路径无效');
  if (prefix !== import.meta.env.BASE_URL.replace(/\/$/, '')) throw new Error('页面挂载路径必须与构建基路径一致');
  router = createRouter({ history: createWebHistory(`${prefix}/`), routes: [
    { path: '/', redirect: '/policies' },
    { path: '/policies', component: PoliciesView },
    { path: '/policies/resources', component: TypedPoliciesView, props: { view: 'resources' } },
    { path: '/policies/ips', component: TypedPoliciesView, props: { view: 'ips' } },
    { path: '/policies/subjects', component: TypedPoliciesView, props: { view: 'subjects' } },
    { path: '/policies/customers', component: TypedPoliciesView, props: { view: 'customers' } },
    { path: '/policies/custom', component: TypedPoliciesView, props: { view: 'custom' } },
    { path: '/policies/typed/new', component: TypedPolicyEditorView },
    { path: '/policies/typed/:id', component: TypedPolicyEditorView },
    { path: '/policies/new', component: PolicyEditorView },
    { path: '/policies/:id', component: PolicyEditorView },
    { path: '/oauth-callback', component: OAuthCallbackView },
    { path: '/:pathMatch(.*)*', redirect: '/policies' }
  ] });
  configurePolicyApi(props.apiBase ?? '/api/limiter', () => router?.currentRoute.value.fullPath ?? '/policies');
  applyPortalIdentity(props.getCurrentUser ? props.getCurrentUser() : props.currentUser);
  const element = props.container?.querySelector('#app') ?? document.querySelector('#app');
  if (!(element instanceof HTMLElement)) throw new Error('缺少应用挂载节点');
  app = createApp(App);
  app.use(router);
  app.mount(element);
  root = element.querySelector('.limiter-management-app');
  update(props);
  scheduleLimiterTokenRenewal();
}
renderWithQiankun({ bootstrap() {}, mount(props) { mount(props as MountProps); }, unmount, update(props) { update(props as MountProps); } });
if (!qiankunWindow.__POWERED_BY_QIANKUN__) mount();
