import CoreWLAN
import Foundation

struct WiFiInfo: Codable {
    let ssid: String
    let bssid: String
    let rssi: Int
    let noise: Int
    let channel: Int
    let band: String
    let txRate: Double
    let security: String
    let phyMode: String
    var nearbyNetworks: [NearbyNetwork]
}

struct NearbyNetwork: Codable {
    let ssid: String
    let bssid: String
    let rssi: Int
    let channel: Int
    let band: String
}

guard let iface = CWWiFiClient.shared().interface() else {
    let err = ["error": "No WiFi interface found"]
    if let data = try? JSONSerialization.data(withJSONObject: err),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
    exit(1)
}

let securityStr: String = {
    switch iface.security() {
    case .wpa2Personal: return "WPA2 Personal"
    case .wpa2Enterprise: return "WPA2 Enterprise"
    case .wpa3Personal: return "WPA3 Personal"
    case .wpa3Enterprise: return "WPA3 Enterprise"
    case .wpaPersonal: return "WPA Personal"
    case .wpaEnterprise: return "WPA Enterprise"
    case .dynamicWEP: return "WEP"
    case .none: return "Open"
    default: return "Unknown"
    }
}()

let phyModeStr: String = {
    switch iface.activePHYMode() {
    case .mode11a: return "802.11a"
    case .mode11b: return "802.11b"
    case .mode11g: return "802.11g"
    case .mode11n: return "802.11n"
    case .mode11ac: return "802.11ac"
    case .mode11ax: return "802.11ax (Wi-Fi 6)"
    default: return "Unknown"
    }
}()

var nearby: [NearbyNetwork] = []
let currentSSID = iface.ssid() ?? ""

do {
    let networks = try iface.scanForNetworks(withName: currentSSID.isEmpty ? nil : currentSSID)
    for net in networks {
        let n = NearbyNetwork(
            ssid: net.ssid ?? "",
            bssid: net.bssid ?? "",
            rssi: net.rssiValue,
            channel: net.wlanChannel?.channelNumber ?? 0,
            band: net.wlanChannel?.channelBand == .band5GHz ? "5GHz" : "2.4GHz"
        )
        nearby.append(n)
    }
} catch {
    // Scan may fail without location permission
}

let info = WiFiInfo(
    ssid: iface.ssid() ?? "",
    bssid: iface.bssid() ?? "",
    rssi: iface.rssiValue(),
    noise: iface.noiseMeasurement(),
    channel: iface.wlanChannel()?.channelNumber ?? 0,
    band: iface.wlanChannel()?.channelBand == .band5GHz ? "5GHz" : "2.4GHz",
    txRate: iface.transmitRate(),
    security: securityStr,
    phyMode: phyModeStr,
    nearbyNetworks: nearby
)

let encoder = JSONEncoder()
encoder.outputFormatting = .prettyPrinted
if let data = try? encoder.encode(info),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
