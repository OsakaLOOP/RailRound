declare module "*.jsx" {
  import type { ComponentType } from "react";

  const component: ComponentType<any>;
  export default component;
  export const DragProvider: ComponentType<any>;
  export const DropZone: ComponentType<any>;
  export const LoginModal: ComponentType<any>;
  export const VersionBadge: ComponentType<any>;
}

declare module "./components/DragContext" {
  import type { ComponentType, ReactNode } from "react";

  export const DragProvider: ComponentType<{ children?: ReactNode }>;
  export const DropZone: ComponentType<{
    onDrop: (item: any) => void;
    children?: ReactNode;
    className?: string;
    activeClassName?: string;
  }>;
  export function useDrag(): any;
}

declare module "../components/DragContext" {
  export * from "./components/DragContext";
}

declare module "./components/LoginModal" {
  import type { ComponentType } from "react";

  export const LoginModal: ComponentType<any>;
}

declare module "../VersionBadge" {
  import type { ComponentType } from "react";

  export const VersionBadge: ComponentType<any>;
}

declare module "./utils/db" {
  export const db: any;
}

declare module "../utils/db" {
  export const db: any;
}

declare module "./buildKml" {
  export default function buildKMLString(...args: any[]): string;
}

declare module "./core/tripCalculator" {
  export function calcDist(...args: any[]): number;
  export function sliceGeoJsonPath(...args: any[]): any;
  export function getRouteVisualData(...args: any[]): any;
  export function calculateLatestStats(...args: any[]): any;
}

declare module "../core/tripCalculator" {
  export * from "./core/tripCalculator";
}

declare module "../../core/tripCalculator" {
  export * from "./core/tripCalculator";
}

declare module "../tripCalculator" {
  export * from "./core/tripCalculator";
}

declare module "./services/api" {
  export const api: any;
}

declare module "../services/api" {
  export const api: any;
}

declare module "../../services/api" {
  export const api: any;
}

declare module "./utils/routes" {
  export const SITE_ORIGIN: string;
  export const APP_LANGS: readonly string[];
  export const APP_TABS: readonly string[];
  export const DEFAULT_APP_LANG: string;
  export const DEFAULT_APP_TAB: string;
  export const APP_LANG_TO_I18N: Record<string, string>;
  export const APP_LANG_TO_HTML: Record<string, string>;
  export const APP_LANG_TO_HREFLANG: Record<string, string>;
  export function isAppLang(value: unknown): boolean;
  export function isAppTab(value: unknown): boolean;
  export function normalizeAppLang(value: unknown, fallback?: string | null): string | null;
  export function normalizeAppTab(value: unknown, fallback?: string | null): string | null;
  export function toI18nLang(value: unknown): string;
  export function buildAppPath(lang?: string | null, tab?: string | null): string;
  export function buildAppUrl(lang?: string | null, tab?: string | null): string;
  export function buildBlogPath(lang?: string | null, rest?: string): string;
  export function buildFeedbackCallbackPath(lang?: string | null): string;
  export function getCanonicalBlogBase(lang?: string | null): string;
  export function getAppSeo(lang?: string | null, tab?: string | null): { title: string; description: string };
  export function getRouteInfoFromPath(pathname?: string): { lang: string; tab: string } | null;
  export function getPreferredAppLang(...values: unknown[]): string;
  export function getCanonicalAppPath(pathname?: string, fallbackLang?: string | null): string | null;
  export function buildAppPathForLanguage(pathname?: string, targetLang?: string | null): string;
}

declare module "../utils/routes" {
  export * from "./utils/routes";
}

declare module "../../utils/routes" {
  export * from "./utils/routes";
}

declare module "../../utils/CachedTileLayer" {
  export function cachedTileLayer(...args: any[]): any;
}

declare module "../../../public/functions/api/feedback/_github.js" {
  export const buildIssueMarker: any;
  export const buildIssueDraft: any;
  export const buildIssueDraftUrl: any;
  export const formatUtcForTitle: any;
  export const normalizeIssueLabels: any;
  export const normalizeIssueState: any;
  export const buildHookSuccessFromIssue: any;
  export const isIssueLabelSuperset: any;
  export const toIssueListItem: any;
  export const makeReadableError: any;
  export const getIssueTicketSecret: any;
}

declare module "../../../public/functions/api/feedback/_shared.js" {
  export const commonHeaders: any;
  export const withMethodHeaders: any;
  export const json: any;
  export const getKV: any;
  export const getFeedbackBucket: any;
  export const getUsernameFromAuthHeader: any;
  export const assertAdmin: any;
  export const sha256Hex: any;
  export const hmacHex: any;
  export const secureCompareHex: any;
  export const getImageSigningSecret: any;
  export const clipText: any;
  export const appendToFeedbackIndex: any;
  export const getFeedbackIndexPage: any;
  export const getAllFeedbackIds: any;
  export const getMimeExtension: any;
  export const getAllFeedbackDebugDump: any;
  export const getIssueCategoryLabel: any;
  export const getReporterLabel: any;
  export const putFeedbackObject: any;
  export const getFeedbackObject: any;
}

declare module "@blog-src/components/mdx/RouteSlicePreviewStatic" {
  import type { ComponentType } from "react";

  export const RouteSlicePreview: ComponentType<any>;
}

declare global {
  interface Window {
    __dropZoneRegistry?: Record<string, (item: any) => void>;
  }
}
