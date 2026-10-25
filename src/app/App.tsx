import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import {
  createStackNavigator,
  type StackScreenProps,
} from '@react-navigation/stack';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CodeScreen, PhoneScreen, WelcomeScreen } from '../features/auth';
import { colors } from '../shared/ui';
import type { RootStackParamList } from './routes';

const Stack = createStackNavigator<RootStackParamList>();

/** Background of the container and cards, so no light frame shows. */
const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg },
};

function Welcome({ navigation }: StackScreenProps<RootStackParamList, 'Welcome'>) {
  return <WelcomeScreen onSignIn={() => navigation.navigate('Phone')} />;
}

function Phone({ navigation }: StackScreenProps<RootStackParamList, 'Phone'>) {
  return (
    <PhoneScreen
      onCodeSent={() => navigation.navigate('Code')}
      onExit={() => navigation.goBack()}
    />
  );
}

function Code({ navigation }: StackScreenProps<RootStackParamList, 'Code'>) {
  return <CodeScreen onChangeNumber={() => navigation.goBack()} />;
}

/**
 * App root. The JS stack (ADR 0007): `detachInactiveScreens={false}` renders
 * plain Views, never react-native-screens; no header, no gestures (remote
 * only). Covered screens stay mounted; each screen traps focus (`Screen`).
 * Session detection (Story 2.5) and the Shell (Story 2.4) come later.
 */
function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <NavigationContainer theme={theme}>
        <Stack.Navigator
          initialRouteName="Welcome"
          detachInactiveScreens={false}
          screenOptions={{ headerShown: false, gestureEnabled: false }}
        >
          <Stack.Screen name="Welcome" component={Welcome} />
          <Stack.Screen name="Phone" component={Phone} />
          <Stack.Screen name="Code" component={Code} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

export default App;
