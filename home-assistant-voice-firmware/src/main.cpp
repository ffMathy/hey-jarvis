#include <iostream>
#include <string>

class HelloWorldApp {
private:
    std::string name;

public:
    HelloWorldApp(const std::string& name = "World") : name(name) {
        std::cout << "Hello World Voice Firmware initialized" << std::endl;
    }
    
    void greet() {
        std::cout << "Hello, " << name << "!" << std::endl;
    }
    
    void run() {
        std::cout << "Starting Hello World Voice Firmware..." << std::endl;
        greet();
        std::cout << "Voice Firmware completed successfully!" << std::endl;
    }
};

int main() {
    std::cout << "Starting Hello World Voice Firmware Application..." << std::endl;
    
    HelloWorldApp app("Voice Firmware");
    app.run();
    
    return 0;
}