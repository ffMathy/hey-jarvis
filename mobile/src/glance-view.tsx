import { useImperativeHandle, useRef } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { bridgeActionOf, navigationVerdict, resultDeliveryScript } from './glance-bridge';
import type { GlanceViewProps } from './platform-contracts';
import { theme } from './theme';

/**
 * A glance's page on a phone: a WebView, locked down.
 *
 * - **Only its own origin loads in it.** Every navigation is put to `navigationVerdict`: another
 *   web page opens in the phone's browser, and anything that is not one — `intent:`, `tel:`, an
 *   app's deep link — goes nowhere. `originWhitelist` is every origin on purpose: the library's own
 *   check matches an origin's *start* (so `https://jarvis.example.com.evil.example` passed it) and
 *   hands what fails it to `Linking` itself, whatever its scheme. With every origin let through, each
 *   navigation reaches the verdict instead.
 * - **No files, no new windows, no cleartext.** A `window.open` or a `target="_blank"` link comes
 *   back as a navigation, and so through the verdict.
 * - **JavaScript on**, which the bridge needs: the server's script answers `window.jarvis.act`.
 *
 * A message counts only from a page on the glance's origin, so a frame the page embeds cannot press
 * its buttons for it.
 */
export function GlanceView({ url, origin, title, onAction, ref }: GlanceViewProps) {
  const webView = useRef<WebView>(null);

  useImperativeHandle(
    ref,
    () => ({
      deliverResult: (result) => webView.current?.injectJavaScript(resultDeliveryScript(result)),
    }),
    [],
  );

  const onShouldStartLoadWithRequest = ({ url: next }: WebViewNavigation) => {
    const verdict = navigationVerdict(next, origin);
    if (verdict === 'open-outside') {
      void Linking.openURL(next);
    }
    return verdict === 'load';
  };

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    if (navigationVerdict(nativeEvent.url, origin) !== 'load') return;
    const action = bridgeActionOf(nativeEvent.data);
    if (action) onAction(action.actionId);
  };

  return (
    <WebView
      ref={webView}
      source={{ uri: url }}
      style={styles.page}
      accessibilityLabel={title}
      testID="glance-page"
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onMessage={onMessage}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      geolocationEnabled={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      // Dark behind the page while it loads, as the rest of the app is.
      containerStyle={styles.page}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
