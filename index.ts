import type { weatherCloudId, countryCode, periodStr } from "./types/weatherCloud";
import { chillFn, heatFn, fetchData, setCookies, parseDevicesList, getCookie } from "./utils";


export async function fetchWeather(id:weatherCloudId) { // fetch general weather data
    try {
        if (!id || /^\d{10}$/.test(id)) throw new Error("invalid ID")
        const fullReport = {
            weather: {},
            update: {},
            profile: {},
        };

        /* --------------------------- request basic data --------------------------- */
        const data = await fetchData(`https://app.weathercloud.net/device/values?code=${id}`);
        const lastUpdate = await fetchData(`https://app.weathercloud.net/device/ajaxupdatedate`, `d=${id}`);
        const profile = await fetchData(`https://app.weathercloud.net/device/ajaxprofile`, `d=${id}`);

        /* --------------------------- check data presence -------------------------- */
        if (!("temp" in data) ||
            !("update" in lastUpdate) ||
            !("observer" in profile)
        ) throw new Error("Failed to fetch");

        /* ------------------------------ parse weather ----------------------------- */
        // calculate clouds height
        const cloudsHeight = (data.temp > -40 && data.dew > -40) ? Math.max(0, 124.69*(data.temp - data.dew)) : -1;

        // check data validity
        if (data.bar < 0 ||
            data.rainrate < 0 ||
            cloudsHeight < 0 ||
            data.hum < 0 ||
            data.hum > 100
        ) throw new Error("Invalid data");

        // guess current conditions based on data
        let weatherAvg = "clear";
        if (data.rainrate == 0) {
            const barTH = [1005,1010,1015];
            const fogTH = 150;
            if (data.bar < barTH[0]) weatherAvg = "cloud";
            else if (data.bar < barTH[1]) weatherAvg = "change";
            else if (data.bar < barTH[2]) weatherAvg = "few";
            
            if (cloudsHeight < fogTH) weatherAvg += "-fog";
        } else {
            const rainrateTH = [2,15];
            if (data.rainrate < rainrateTH[0]) weatherAvg = "light";
            else if (data.rainrate < rainrateTH[1]) weatherAvg = "moderate";
            else weatherAvg = "heavy";
        }

        // get feel (maybe just like chill and heat but used in weather cloud code so here it is)
        let feel = data.temp;
        if (data.temp < 10) feel = chillFn(data.temp, data.wspd);
        else if (data.temp > 26) feel = heatFn(data.temp, data.hum);
        // save the added data
        const { epoch, ...dataToSave } = data;
        fullReport.weather = {
            ...dataToSave,
            cloudsHeight,
            weatherAvg,
            feel
        };

        /* ---------------------------- parse update time --------------------------- */
	    const time = new Date(epoch*1000);
        fullReport.update = {
            ...lastUpdate,
            time: `${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`,
            lastUpdateMinutes: Math.round(lastUpdate.update/60),
            updateTime: epoch
        };

        /* ------------------------------ parse profile ----------------------------- */
        fullReport.profile = profile; // nothing to add

        return fullReport;
    } catch (err) {
        return { error: err }
    }
}

export async function getStationStatus(id:weatherCloudId) { // fetch the station status [NEED LOGIN]
    try {
        if ((await getCookie()).length < 1) throw new Error("Session required!");
        const data = await fetchData(`https://app.weathercloud.net/device/ajaxdevicestats`, `device=${id}`);
        if (!data || !Array.isArray(data) || !("date" in data[0]))  throw new Error("Failed to fetch");
        return data;
    } catch (err) {
        return { error: err };
    }
}

export async function getStatistics(id:weatherCloudId) {
    try {
        const data = await fetchData(`https://app.weathercloud.net/device/stats`, `code=${id}`);
        if (!data || !("temp_current" in data))  throw new Error("Failed to fetch");
        return data;
    } catch (err) {
        return { error: err };
    }
}

export async function getNearest(lat: string|number, lon: string|number, radius: string|number) {
    try {
        const data = await fetchData(`https://app.weathercloud.net/page/coordinates/latitude/${lat}/longitude/${lon}/distance/${radius}`);
        if (!data || !("devices" in data) || !Array.isArray(data.devices))  throw new Error("Failed to fetch");
        return parseDevicesList(data.devices, "distance");
    } catch (err) {
        return [ { error: err } ];
    }
}

export async function getTop(definer:"newest"|"followers"|"popular",countryCode:countryCode, period?:periodStr) {
    try {
        let url = `https://app.weathercloud.net/page/${definer}/country/${countryCode}`;
        if (definer === "popular") {
            if (!period) throw new Error("Period required for popular ranking");
            url += `/period/${period}`;
        }
        console.log(url)
        const data = await fetchData(url);
        if (!data || !("devices" in data) || !Array.isArray(data.devices))  throw new Error("Failed to fetch");
        let dataType:string = definer;
        if (definer === "newest") dataType = "age";
        if (definer === "popular") dataType = "views";
        return parseDevicesList(data.devices, dataType);
    } catch (err) {
        return { error: err };
    }
}

export async function getOwn() {
    try {
        if ((await getCookie()).length < 1) throw new Error("Session required!");
        const data = await fetchData(`https://app.weathercloud.net/page/own`);
        if (!data || !("devices" in data) || !("favorites" in data))  throw new Error("Failed to fetch");
        return {
            devices: parseDevicesList(data.devices),
            favorites: parseDevicesList(data.favorites),
        };
    } catch (err) {
        return { error: err };
    }
}

export async function login(mail:string, password: string, storeCredentials?: boolean) { // log in and retrieve the session cookie
    const formData = new URLSearchParams();
    formData.append('LoginForm[entity]', mail);
    formData.append('LoginForm[password]', password);
    formData.append('LoginForm[rememberMe]', '1');
    const resp = await fetch("https://app.weathercloud.net/signin", {
        method: "post",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
        },
        body: formData,
        redirect: "manual"
    });
    if (resp.status !== 302) return false;
    // define what we should store
    const store = storeCredentials ? { mail, password } : {
        mail: "",
        password: ""
    }
    if (!setCookies(resp.headers.getSetCookie().join("; ").split("; "), store.mail, store.password)) return false;
    else return true;
}
