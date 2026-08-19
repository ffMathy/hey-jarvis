#pragma once

#include "esphome/core/component.h"
#include "esphome/core/automation.h"
#include "esphome/core/helpers.h"
#include "esphome/components/network/ip_address.h"
#include "esphome/components/audio/audio.h"
#include "elevenlabs_client.h"

#include <esp_websocket_client.h>
#include <esp_http_client.h>
#include <esp_timer.h>
#include <mbedtls/base64.h>

namespace esphome {

// Forward declarations for optional components
namespace microphone { class Microphone; }
namespace speaker { class Speaker; }

namespace elevenlabs_stream {

class ElevenLabsClient;
class ElevenLabsStream;
void websocket_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data);

enum class StreamState {
  OFF,    // Connection closed, not listening
  ON      // Connected and streaming audio both ways
};

class ElevenLabsStream : public Component {
  // Sets the speaker's audio stream info based on the agent output format, if available.
  void set_speaker_stream_info_to_elevenlabs_format();
public:
  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_CONNECTION; }

  void set_agent_id(const std::string &agent_id) { this->agent_id_ = agent_id; }
  void set_api_key(const std::string &api_key) { this->api_key_ = api_key; }
  void set_microphone(microphone::Microphone *microphone) { this->microphone_ = microphone; }
  void set_elevenlabs_speaker(speaker::Speaker *speaker) { this->elevenlabs_speaker_ = speaker; }
  void set_activation_speaker(speaker::Speaker *speaker) { this->activation_speaker_ = speaker; }
  void set_initial_message(const std::string &message) { this->initial_message_ = message; }

  bool start_stream();
  bool start_stream(const std::string &initial_message);
  bool start_stream(const std::string &initial_message, uint32_t timeout_ms);
  void stop_stream();
  bool is_running() const { return this->state_ == StreamState::ON; }
  StreamState get_state() const { return this->state_; }
  void handle_microphone_data(const std::vector<uint8_t> &data);
  void handle_websocket_disconnected();

  // Speaker activity tracking
  bool is_speaker_active() const;

  // Triggers - simplified to just on/off and error
  void add_on_start_trigger(Trigger<> *trigger) { this->on_start_triggers_.push_back(trigger); }
  void add_on_end_trigger(Trigger<> *trigger) { this->on_end_triggers_.push_back(trigger); }
  void add_on_error_trigger(Trigger<std::string> *trigger) { this->on_error_triggers_.push_back(trigger); }
  void add_on_listening_trigger(Trigger<> *trigger) { this->on_listening_triggers_.push_back(trigger); }
  void add_on_processing_trigger(Trigger<> *trigger) { this->on_processing_triggers_.push_back(trigger); }
  void add_on_replying_trigger(Trigger<> *trigger) { this->on_replying_triggers_.push_back(trigger); }

  bool is_connected() const {
    return this->client_ && this->client_->is_connected();
  }

 protected:
  friend void websocket_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data);

  // Internal methods
  void renew_signed_url_if_needed();
  bool send_websocket_message(const std::string &message);
  void handle_websocket_message(const uint8_t *buffer, size_t length);
  void parse_json_message_from_buffer(uint8_t *buffer, size_t length);
  void handle_error(const std::string &error_message);
  void send_conversation_init();
  void capture_and_send_audio();
  void send_ping();
  void send_audio_chunk(const std::vector<int16_t> &audio_data);
  void set_state(StreamState new_state);
  bool decode_and_play_base64_audio(const char* base64_data);

  std::string agent_id_;
  std::string api_key_;
  microphone::Microphone *microphone_{nullptr};
  speaker::Speaker *elevenlabs_speaker_{nullptr};
  speaker::Speaker *activation_speaker_{nullptr};
  ElevenLabsClient* client_ = nullptr;
  StreamState state_{StreamState::OFF};

  // Protocol state members for ElevenLabs API
  std::string conversation_id_;
  std::string agent_output_audio_format_;
  std::string user_input_audio_format_;
  std::string signed_url_; // Stores the current signed URL for ElevenLabs WebSocket
  
  // Notification/proactive message support
  std::string initial_message_; // Custom initial message for proactive notifications

  // How long an announcement waits for a reply before hanging up, and the state used to
  // time it. 0 disables the whole mechanism, which is what wake-word conversations use:
  // somebody said the wake word, so they are already talking and the call should live as
  // long as the agent's own settings allow.
  //
  // Timed here rather than by the service, because silence_end_call_timeout is not an
  // overridable field -- the overridable set is prompt, first_message, language, LLM,
  // tool_ids, knowledge_base, the TTS voice settings, text_only and asr.keywords -- and
  // ElevenLabs errors the conversation outright when it is sent one that is not enabled.
  //
  // The earlier local attempt failed for a different reason: it timed the gap between
  // outgoing microphone chunks, and the microphone streams continuously while the socket
  // is open, so the gap was always about zero. The signal it needed was already arriving
  // and being ignored -- vad_score, the service's own estimate of whether a person is
  // speaking, which the LED ring has been driven from all along.
  uint32_t response_window_ms_{0};
  // True while an announcement is still waiting to hear a reply. Cleared for good by the
  // first real transcript: from then on somebody is in the conversation and the window
  // has served its purpose.
  bool awaiting_response_{false};
  // True once the agent has produced audio in this stream. The clock must not run before
  // that, or the window expires while the announcement is still being synthesised.
  bool agent_has_spoken_{false};
  // Start of the current unbroken run of silence, refreshed by speech and by the agent's
  // own playback. 0 means the clock is not running.
  uint32_t silence_started_ms_{0};

  // True from the moment a connection attempt begins until it reaches ON or fails.
  //
  // StreamState is OFF/ON only, and ON is not set until roughly 1.75s after the socket
  // opens, so "already ON" does not cover the window in which a connection is being
  // built. Without this, a second start() inside that window walks straight past the
  // guard and calls connect() again -- which stops and destroys the websocket client
  // from the main task while the websocket's own task may still be inside the message
  // handler. That is the reboot seen when triggering announce twice in a row.
  bool starting_{false};

  // Set when the agent invokes the end_call system tool. The stream is not torn down on
  // the spot: end_call is usually preceded by a goodbye, and the tool response arrives
  // while that audio is still playing. loop() waits for the speaker to drain first.
  bool end_call_requested_{false};
  // When that request arrived, so the goodbye is given a moment to start. The tool
  // response can land before the speech that accompanies it has been synthesised, and
  // hanging up on an empty buffer would cut the agent off mid-farewell.
  uint32_t end_call_requested_ms_{0};

  // Triggers - simplified
  std::vector<Trigger<> *> on_start_triggers_;
  std::vector<Trigger<> *> on_end_triggers_;
  std::vector<Trigger<std::string> *> on_error_triggers_;
  std::vector<Trigger<> *> on_listening_triggers_;
  std::vector<Trigger<> *> on_processing_triggers_;
  std::vector<Trigger<> *> on_replying_triggers_;

  // Audio buffering
  std::vector<int16_t> audio_buffer_;
  std::vector<uint8_t> response_audio_buffer_;
  
  // WebSocket message fragmentation handling
  WebsocketMessageAssembler reassembler_;
  
  // Timing and configuration constants
  uint32_t last_audio_time_{0};

  // Prebuffer for the opening of each reply. Decoded audio is accumulated here until
  // there is enough of a cushion to start playback, then written in one go. Without it
  // the first fragment plays into a pipeline that has not settled, and the opening word
  // arrives chopped, gapped or doubled depending on the timing.
  std::vector<uint8_t> reply_prebuffer_;
  bool reply_prebuffering_{true};
  uint32_t reply_prebuffer_started_ms_{0};
  uint32_t last_audio_response_time_{0};  // Track when we last received audio from agent
  uint32_t connection_timeout_{10000};  // Reduced to 10 seconds
  uint32_t connection_start_time_{0};
  uint32_t last_heartbeat_{0};
  uint32_t last_signed_url_renewal_{0};  // Track when we last renewed the signed URL
  uint32_t signed_url_renewal_interval_{600000};  // 10 minutes in milliseconds

  // Accumulated playback duration for all segments
  uint32_t accumulated_duration_ms_{0};
  
  // Speaker activity tracking to prevent microphone echo/feedback
  bool speaker_is_active_{false};  // Track if agent is currently speaking
  uint32_t speaker_start_time_{0};  // When current audio playback started
  uint32_t speaker_end_time_{0};   // When current audio playback should end
  uint32_t speaker_silence_buffer_ms_{500};  // Wait time after speaker stops before enabling mic

  // Last VAD score for tracking voice activity detection
  float last_vad_score_ = 0.0f;

  // Initial audio stream info
  esphome::audio::AudioStreamInfo activation_speaker_audio_stream_info{};
  bool activation_speaker_audio_stream_infoset_ = false;
  
  // PSRAM monitoring baseline
  size_t psram_baseline_{0};  // Initial free PSRAM at setup for tracking memory usage trends
};

// Actions
template<typename... Ts> class ElevenLabsStreamStartAction : public Action<Ts...>, public Parented<ElevenLabsStream> {
 public:
  TEMPLATABLE_VALUE(std::string, initial_message)
  TEMPLATABLE_VALUE(uint32_t, timeout)
  
  void play(const Ts &...x) override {
    auto initial_message = this->initial_message_.optional_value(x...);
    auto timeout = this->timeout_.optional_value(x...);
    
    if (initial_message.has_value() && timeout.has_value()) {
      this->parent_->start_stream(initial_message.value(), timeout.value());
    } else if (initial_message.has_value()) {
      this->parent_->start_stream(initial_message.value());
    } else {
      this->parent_->start_stream();
    }
  }
};

template<typename... Ts> class ElevenLabsStreamStopAction : public Action<Ts...>, public Parented<ElevenLabsStream> {
 public:
  void play(Ts... x) override { this->parent_->stop_stream(); }
};

// Triggers - simplified
class ElevenLabsStreamStartTrigger : public Trigger<> {};
class ElevenLabsStreamEndTrigger : public Trigger<> {};
class ElevenLabsStreamErrorTrigger : public Trigger<std::string> {};
class ElevenLabsStreamListeningTrigger : public Trigger<> {};
class ElevenLabsStreamProcessingTrigger : public Trigger<> {};
class ElevenLabsStreamReplyingTrigger : public Trigger<> {};

// Condition
template<typename... Ts> class ElevenLabsStreamIsRunningCondition : public Condition<Ts...> {
public:
  ElevenLabsStreamIsRunningCondition(ElevenLabsStream *parent) : parent_(parent) {}
  bool check(Ts... x) override { return this->parent_->is_running(); }
  void set_parent(ElevenLabsStream *parent) { this->parent_ = parent; }
protected:
  ElevenLabsStream *parent_;
};

}  // namespace elevenlabs_stream
}  // namespace esphome
