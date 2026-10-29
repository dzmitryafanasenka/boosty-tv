/**
 * Jest mock of `react-native-svg/css` (ADR 0014): react-native-qrcode-svg's
 * logo support imports `LocalSvg` from it. The app never passes a logo; the
 * real module needs the native asset registry, absent in Jest.
 */
const React = require('react');

function LocalSvg(props) {
  return React.createElement('LocalSvg', props);
}

module.exports = { __esModule: true, LocalSvg };
