import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

/**
 * Azure Cognitive Services – Speech-to-Text
 * Transcribes audio from microphone input
 * @returns {Promise<string>} Transcribed text
 */
export async function speechToText() {
  if (!SPEECH_KEY || !SPEECH_REGION) {
    throw new Error('Azure Cognitive Services – Speech is required for ConRad to operate. Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION.');
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  speechConfig.speechRecognitionLanguage = 'en-US';

  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  return new Promise((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();

        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
          resolve(result.text);
        } else if (result.reason === sdk.ResultReason.NoMatch) {
          reject(new Error('No speech could be recognized. Please try again.'));
        } else if (result.reason === sdk.ResultReason.Canceled) {
          const cancellation = sdk.CancellationDetails.fromResult(result);
          reject(new Error(`Speech recognition canceled: ${cancellation.reason}. ${cancellation.errorDetails || ''}`));
        } else {
          reject(new Error('Azure Cognitive Services – Speech is required for ConRad to operate.'));
        }
      },
      (error) => {
        recognizer.close();
        reject(new Error(`Azure Cognitive Services – Speech is required for ConRad to operate. Error: ${error}`));
      }
    );
  });
}

export default { speechToText };
