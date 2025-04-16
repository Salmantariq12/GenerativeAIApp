using Concentus.Oggfile;
using Concentus.Structs;
using Google.Cloud.Speech.V1;
using Google.Cloud.TextToSpeech.V1;
using Microsoft.AspNetCore.Mvc;
using NAudio.Wave;
using Newtonsoft.Json;

namespace GenerativeAIApp.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class VoiceProcessorController : ControllerBase
    {
        private readonly string _apiKey;
        private readonly string _serviceAccountPath;

        public VoiceProcessorController(IConfiguration config)
        {
            _apiKey = config["ApiKey"];
            _serviceAccountPath = config["ServiceAccountPath"];
        }

        [HttpPost]
        public async Task<IActionResult> ProcessAudio()
        {
            try
            {
                var file = Request.Form.Files.FirstOrDefault();
                if (file == null || file.Length == 0)
                    return BadRequest("No audio file uploaded.");

                byte[] wavData = ConvertAudioFileType(file.OpenReadStream());

                string transcript = await PerformSpeechToText(wavData);
                //if (string.IsNullOrEmpty(transcript))
                //    return BadRequest("No transcription found.");

                if (string.IsNullOrEmpty(transcript))
                {
                    string errorMessage = "Sorry, I couldn't understand that. Please try again.";
                    byte[] errorAudio = await ConvertTextToSpeech(errorMessage);

                    if (errorAudio == null || errorAudio.Length == 0)
                        return BadRequest("Failed to generate error speech audio.");

                    return File(errorAudio, "audio/mp3", "error_response.mp3");
                }

                Console.WriteLine($"Transcribed Text: {transcript}");

                string aiReply = await GetGeminiResponse(transcript);
                Console.WriteLine("Gemini AI Response: " + aiReply);

                byte[] speechAudio = await ConvertTextToSpeech(aiReply);
                if (speechAudio == null || speechAudio.Length == 0)
                    return BadRequest("Failed to generate speech audio.");

                return File(speechAudio, "audio/mp3", "ai_response.mp3");
            }
            catch (Exception ex)
            {
                return BadRequest($"Error: {ex.Message}");
            }
        }

        private async Task<string> PerformSpeechToText(byte[] audioData)
        {
            Environment.SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", _serviceAccountPath);

            var speechClient = SpeechClient.Create();
            var config = new RecognitionConfig
            {
                Encoding = RecognitionConfig.Types.AudioEncoding.Linear16,
                SampleRateHertz = 48000,
                LanguageCode = "en-US"
            };
            var audio = RecognitionAudio.FromBytes(audioData);
            var response = await speechClient.RecognizeAsync(config, audio);

            return response.Results.FirstOrDefault()?.Alternatives.FirstOrDefault()?.Transcript ?? "";
        }

        private async Task<byte[]> ConvertTextToSpeech(string text)
        {
            var client = TextToSpeechClient.Create();
            var request = new SynthesizeSpeechRequest
            {
                Input = new SynthesisInput { Text = text },
                Voice = new VoiceSelectionParams
                {
                    LanguageCode = "en-US",
                    SsmlGender = SsmlVoiceGender.Female
                },
                AudioConfig = new AudioConfig
                {
                    AudioEncoding = AudioEncoding.Mp3
                }
            };

            var response = await client.SynthesizeSpeechAsync(request);
            return response.AudioContent.ToByteArray();
        }

        public static byte[] ConvertAudioFileType(Stream webmStream)
        {
            string tempInputFile = Path.GetTempFileName() + ".webm";
            using (var fileStream = new FileStream(tempInputFile, FileMode.Create, FileAccess.Write))
            {
                webmStream.CopyTo(fileStream);
            }

            string tempOutputFile = Path.GetTempFileName() + ".wav";

            using (var reader = new MediaFoundationReader(tempInputFile))
            using (var wavWriter = new WaveFileWriter(tempOutputFile, reader.WaveFormat))
            {
                reader.CopyTo(wavWriter);
            }

            byte[] wavBytes = System.IO.File.ReadAllBytes(tempOutputFile);

            System.IO.File.Delete(tempInputFile);
            System.IO.File.Delete(tempOutputFile);

            return wavBytes;
        }


        private async Task<string> GetGeminiResponse(string userInput)
        {
            using var client = new HttpClient();
            var requestContent = new
            {
                contents = new[]
                {
            new
            {
                parts = new[]
                {
                    new
                    {
                        text = "You are a helpful voice assistant. Keep your responses conversational and concise. " + userInput
                    }
                }
            }
        }
            };

            var response = await client.PostAsJsonAsync(
                $"https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key={_apiKey}",
                requestContent);

            if (!response.IsSuccessStatusCode)
            {
                // Log detailed error information
                string errorDetails = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"Gemini API Error: {response.StatusCode}. Details: {errorDetails}");
                return "Error: Gemini AI response failed.";
            }

            string responseContent = await response.Content.ReadAsStringAsync();
            dynamic result = JsonConvert.DeserializeObject(responseContent);
            string aiText = result?.candidates?[0]?.content?.parts?[0]?.text ?? "No response from AI.";

            aiText = CleanupFormattingForSpeech(aiText);

            return aiText;
        }

        private string CleanupFormattingForSpeech(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;

            // Remove markdown formatting
            text = System.Text.RegularExpressions.Regex.Replace(text, @"\*\*(.*?)\*\*", "$1"); // Bold
            text = System.Text.RegularExpressions.Regex.Replace(text, @"\*(.*?)\*", "$1"); // Italic
            text = System.Text.RegularExpressions.Regex.Replace(text, @"__(.*?)__", "$1"); // Underline
            text = System.Text.RegularExpressions.Regex.Replace(text, @"~~(.*?)~~", "$1"); // Strikethrough
            text = System.Text.RegularExpressions.Regex.Replace(text, @"`(.*?)`", "$1"); // Code

            // Replace common symbols that should be verbalized differently
            text = text.Replace("#", "hash ");

            // Remove markdown headings (# Header)
            text = System.Text.RegularExpressions.Regex.Replace(text, @"^#+\s+", "", System.Text.RegularExpressions.RegexOptions.Multiline);

            // Remove URL formatting
            text = System.Text.RegularExpressions.Regex.Replace(text, @"\[(.*?)\]\((.*?)\)", "$1");

            // Clean up any extra whitespace
            text = System.Text.RegularExpressions.Regex.Replace(text, @"\s+", " ").Trim();

            return text;
        }
    }
}
