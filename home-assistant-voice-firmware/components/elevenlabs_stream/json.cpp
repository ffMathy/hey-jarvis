
// json.cpp
#include "json.h"
#include <esp_heap_caps.h>
#include "esphome/core/log.h"
#include <esphome/components/json/json_util.h>

namespace esphome {
namespace elevenlabs_stream {

static const char *TAG = "json";

std::string JsonDeserializer::to_string(const JsonObject& obj) {
  std::string out;
  serializeJson(obj, out);
  return out;
}

std::unique_ptr<BasicJsonDocument<PSRAMAllocator>> JsonDeserializer::parse(const uint8_t* buffer, size_t length) {
    // Log PSRAM before parsing
    size_t psram_free_before = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    
    // ArduinoJson needs 1.5-2.0x the input size for internal structures (objects, arrays, strings)
    // Use 2x multiplier for safety to prevent overflow with deeply nested JSON
    size_t capacity = length * 2;
    
    auto json_document = std::make_unique<BasicJsonDocument<PSRAMAllocator>>(capacity);
    if (json_document->overflowed()) {
        ESP_LOGD(TAG, "parse: JSON document overflowed with capacity %zu (input length: %zu)", capacity, length);
        return nullptr;
    }
    
    DeserializationError err = deserializeJson(*json_document, (const char*)buffer, length);
    if (err != DeserializationError::Ok) {
        ESP_LOGD(TAG, "parse: JSON deserialization failed: %s", err.c_str());
        return nullptr;
    }
    
    // Shrink to actual usage to free unused PSRAM
    json_document->shrinkToFit();
    
    // Log PSRAM after parsing with delta
    size_t psram_free_after = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    size_t psram_used = psram_free_before - psram_free_after;
    ESP_LOGD(TAG, "parse: JSON_PARSE: PSRAM Free=%zuKB (-%zuKB), input=%zu bytes, capacity=%zu bytes", 
             psram_free_after / 1024, psram_used / 1024, length, capacity);
    
    // Warn if PSRAM is running low
    if (psram_free_after < 1024 * 1024) {
        ESP_LOGW(TAG, "parse: LOW MEMORY WARNING: PSRAM Free=%zuKB", psram_free_after / 1024);
    }
    
    return json_document;
}

std::unique_ptr<BasicJsonDocument<PSRAMAllocator>> JsonDeserializer::parse(const char* cstr) {
    return parse(reinterpret_cast<const uint8_t*>(cstr), strlen(cstr));
}

} // namespace elevenlabs_stream
} // namespace esphome
