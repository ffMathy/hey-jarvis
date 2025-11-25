
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
    size_t heap_free_before = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    
    // ArduinoJson needs 1.5-2.0x the input size for internal structures (objects, arrays, strings)
    // Use 3x multiplier for heavily fragmented PSRAM after speaker buffers allocate
    // This accounts for ArduinoJson overhead + fragmentation + safety margin
    size_t capacity = length * 3;
    
    // Check if we have enough contiguous memory available (with 512KB safety margin)
    size_t required_memory = capacity + (512 * 1024);
    size_t available_memory = psram_free_before + heap_free_before;
    if (available_memory < required_memory) {
        ESP_LOGW(TAG, "parse: Insufficient memory for JSON parsing: need %zuKB, have %zuKB PSRAM + %zuKB heap",
                 required_memory / 1024, psram_free_before / 1024, heap_free_before / 1024);
        return nullptr;
    }
    
    ESP_LOGD(TAG, "parse: Allocating JSON document, capacity=%zu, PSRAM Free=%zuKB, Heap Free=%zuKB", 
             capacity, psram_free_before / 1024, heap_free_before / 1024);
    
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
    size_t heap_free_after = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    size_t psram_delta = psram_free_before - psram_free_after;
    size_t heap_delta = heap_free_before - heap_free_after;
    
    // Determine which heap was primarily used
    if (heap_delta > psram_delta && heap_delta > 1024) {
        ESP_LOGW(TAG, "parse: JSON allocated in regular heap (%zuKB), PSRAM may not be ready", heap_delta / 1024);
    }
    
    ESP_LOGD(TAG, "parse: JSON_PARSE: PSRAM Free=%zuKB (-%zuKB), Heap Free=%zuKB (-%zuKB), input=%zu, capacity=%zu", 
             psram_free_after / 1024, psram_delta / 1024, 
             heap_free_after / 1024, heap_delta / 1024,
             length, capacity);
    
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
