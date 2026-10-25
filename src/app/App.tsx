import { StatusBar } from 'react-native';
import { WelcomeScreen } from '../features/auth';

/**
 * App root. Story 2.1: A1 Welcome is the only screen. Session detection
 * (Story 2.5) and navigation (Stories 2.2 / 2.4) come later.
 */
function App() {
  return (
    <>
      <StatusBar hidden />
      <WelcomeScreen />
    </>
  );
}

export default App;
