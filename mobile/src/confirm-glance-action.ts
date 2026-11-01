import { Alert } from 'react-native';
import type { ConfirmGlanceAction } from './platform-contracts';

/**
 * Asks sir in an Android dialog, with the server's prompt as its message: "Do it" or "Cancel".
 * Tapping outside it, or back, is a cancel.
 */
export const confirmGlanceAction: ConfirmGlanceAction = ({ title, prompt }) =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      prompt,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Do it', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
