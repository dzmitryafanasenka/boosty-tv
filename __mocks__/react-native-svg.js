/**
 * Jest manual mock of react-native-svg 15.15.5 (ADR 0013, ADR 0014; used automatically
 * for the node module). Each SVG element renders a plain host element of the
 * same name with its props as given (no native color or transform
 * processing), so tests can read `stroke`, `fill`, `transform` and the text.
 * Native drawing is a device check.
 */
const React = require('react');

function element(name) {
  function SvgElement(props) {
    return React.createElement(name, props, props.children);
  }
  SvgElement.displayName = name;
  return SvgElement;
}

const Svg = element('Svg');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Circle: element('Circle'),
  G: element('G'),
  Path: element('Path'),
  Rect: element('Rect'),
  Text: element('SvgText'),
  // react-native-qrcode-svg (Story 6.3, ADR 0014).
  ClipPath: element('ClipPath'),
  Defs: element('Defs'),
  Image: element('SvgImage'),
  LinearGradient: element('LinearGradient'),
  Stop: element('Stop'),
  SvgUri: element('SvgUri'),
  SvgXml: element('SvgXml'),
};
