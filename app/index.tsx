import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, TouchableOpacity, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Book, CheckCircle, XCircle, Clock } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

const { width } = Dimensions.get('window');

SplashScreen.preventAutoHideAsync().catch(() => { });

const LOGIN_URL = 'https://adamasknowledgecity.ac.in/student/login';
const ATTENDANCE_URL = 'https://adamasknowledgecity.ac.in/student/attendance';

// Inject JS that autofills saved credentials AND scrapes attendance
const makeInjectedJS = (savedUser: string, savedPass: string) => `
(function() {
  // --- Auto-fill saved credentials ---
  function autofill() {
    try {
      var userInputs = document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]');
      var passInputs = document.querySelectorAll('input[type="password"]');
      if (${savedUser ? 'true' : 'false'} && userInputs.length > 0) {
        var inp = userInputs[0];
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(inp, ${JSON.stringify(savedUser)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (${savedPass ? 'true' : 'false'} && passInputs.length > 0) {
        var pinp = passInputs[0];
        var nativePSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativePSetter.call(pinp, ${JSON.stringify(savedPass)});
        pinp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch(e) {}
  }

  // --- Save credentials on form submit ---
  function watchSubmit() {
    try {
      document.addEventListener('submit', function(e) {
        var form = e.target;
        var userInputs = form.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"]');
        var passInputs = form.querySelectorAll('input[type="password"]');
        if (userInputs.length > 0 && passInputs.length > 0) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'SAVE_CREDENTIALS',
            username: userInputs[0].value,
            password: passInputs[0].value
          }));
        }
      }, true);
    } catch(e) {}
  }

  // --- Scrape attendance table ---
  function scrapeAttendance() {
    try {
      var tables = document.querySelectorAll('table');
      for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        if (table.innerText.includes('Total Attendance')) {
          var rows = table.querySelectorAll('tbody tr');
          if (rows.length === 0) rows = table.querySelectorAll('tr');
          var data = [];
          for (var j = 0; j < rows.length; j++) {
            var row = rows[j];
            var cols = row.querySelectorAll('td, th');
            if (cols.length >= 5) {
              var course = cols[0].innerText.trim().replace(/\\n/g, ' ').replace(/\\s+/g, ' ');
              if (course === 'Courses' || course.includes('Total Number')) continue;
              var marked = cols[1].innerText.trim();
              var present = cols[2].innerText.trim();
              var absent = cols[3].innerText.trim();
              var percentage = cols[4].innerText.trim();
              if (course && percentage && percentage.includes('%')) {
                data.push({ course, marked, present, absent, percentage: percentage.replace('%', '').trim() });
              }
            }
          }
          if (data.length > 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ATTENDANCE_DATA', data }));
            return true;
          }
        }
      }
    } catch(e) {}
    return false;
  }

  autofill();
  watchSubmit();

  var scrapeInterval = setInterval(function() {
    if (scrapeAttendance()) clearInterval(scrapeInterval);
  }, 1500);

  setTimeout(function() { clearInterval(scrapeInterval); }, 180000);
})();
true;
`;

type CourseEntry = {
    course: string;
    marked: string;
    present: string;
    absent: string;
    percentage: string;
};

const BUNK_TARGETS = [75, 65];

function calcBunk(present: number, total: number, target: number): string {
    // How many more can be bunked while maintaining >= target%
    // (present) / (total + extra) >= target/100
    // present >= target/100 * (total + extra)
    // extra <= (present * 100/target) - total
    const maxTotal = Math.floor((present * 100) / target);
    const canBunk = maxTotal - total;
    if (canBunk <= 0) {
        // Need to attend more
        // (present + need) / (total + need) >= target/100
        // present + need >= target/100 * (total + need)
        // need * (1 - target/100) >= (target/100 * total) - present
        const need = Math.ceil(((target / 100) * total - present) / (1 - target / 100));
        return `Attend ${need} more`;
    }
    return `Bunk ${canBunk}`;
}

export default function App() {
    const [showSplash, setShowSplash] = useState(true);
    const [isHiddenWebView, setIsHiddenWebView] = useState(false);
    const [attendanceData, setAttendanceData] = useState<CourseEntry[] | null>(null);
    const [savedUsername, setSavedUsername] = useState('');
    const [savedPassword, setSavedPassword] = useState('');
    const [bunkTarget, setBunkTarget] = useState<number>(75);
    const webViewRef = useRef<any>(null);
    const hasRedirectedRef = useRef(false);

    useEffect(() => {
        // 1. Hide native splash immediately so our JS splash is visible
        SplashScreen.hideAsync().catch(() => { });

        // 2. Load saved credentials
        AsyncStorage.multiGet(['savedUsername', 'savedPassword']).then((pairs) => {
            const user = pairs[0][1] || '';
            const pass = pairs[1][1] || '';
            setSavedUsername(user);
            setSavedPassword(pass);
        });

        // 3. Show our custom JS splash for 2.5 seconds, then proceed
        const timer = setTimeout(() => {
            setShowSplash(false);
        }, 2500);
        return () => clearTimeout(timer);
    }, []);

    const handleMessage = (event: any) => {
        try {
            const parsed = JSON.parse(event.nativeEvent.data);
            if (parsed.type === 'ATTENDANCE_DATA') {
                setAttendanceData(parsed.data);
            } else if (parsed.type === 'SAVE_CREDENTIALS') {
                AsyncStorage.multiSet([
                    ['savedUsername', parsed.username],
                    ['savedPassword', parsed.password],
                ]);
                setSavedUsername(parsed.username);
                setSavedPassword(parsed.password);
            }
        } catch (e) { }
    };

    const handleNavigationStateChange = (navState: any) => {
        if (navState.url && navState.url.includes('/student/dashboard') && !hasRedirectedRef.current) {
            hasRedirectedRef.current = true;
            setIsHiddenWebView(true);
            webViewRef.current?.injectJavaScript(`window.location.href = '${ATTENDANCE_URL}'; true;`);
        }
    };

    // ─── SPLASH SCREEN ───────────────────────────────────────────────────────────
    if (showSplash) {
        return (
            <LinearGradient colors={['#0F2027', '#203A43', '#2C5364']} style={styles.container}>
                <SafeAreaView style={styles.centered}>
                    <MotiView
                        from={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'timing', duration: 1500 }}
                        style={{ alignItems: 'center' }}
                    >
                        <Text style={styles.splashTitle}>Attendance Hub</Text>
                        <Text style={styles.splashBy}>Created by : Aayush :)</Text>
                    </MotiView>
                </SafeAreaView>
            </LinearGradient>
        );
    }

    // ─── WEBVIEW (Login + Hidden Scraping) ───────────────────────────────────────
    if (!attendanceData) {
        return (
            <LinearGradient colors={['#0F2027', '#203A43', '#2C5364']} style={{ flex: 1 }}>
                <SafeAreaView style={{ flex: 1 }}>

                    {/* Always full-screen dark loading cover when navigating in bg */}
                    {isHiddenWebView && (
                        <View style={[StyleSheet.absoluteFillObject as any, { zIndex: 999, elevation: 999 }]}>
                            <LinearGradient colors={['#0F2027', '#203A43', '#2C5364']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                <ActivityIndicator size="large" color="#00f2fe" />
                                <Text style={styles.loadingText}>Loading your attendance...</Text>
                                <Text style={[styles.loadingText, { fontSize: 13, color: '#aaa', marginTop: 6 }]}>Please wait...</Text>
                            </LinearGradient>
                        </View>
                    )}

                    {/* Login header bar */}
                    {!isHiddenWebView && (
                        <View style={styles.webviewHeader}>
                            <Text style={styles.webviewTitle}>Login to Portal</Text>
                        </View>
                    )}

                    {/* WebView: invisible when hidden (opacity 0 + pointerEvents none prevents any tap-through) */}
                    <WebView
                        ref={webViewRef}
                        source={{ uri: LOGIN_URL }}
                        style={{ flex: 1, opacity: isHiddenWebView ? 0 : 1 }}
                        pointerEvents={isHiddenWebView ? 'none' : 'auto'}
                        injectedJavaScript={makeInjectedJS(savedUsername, savedPassword)}
                        onMessage={handleMessage}
                        onNavigationStateChange={handleNavigationStateChange}
                        javaScriptEnabled
                        domStorageEnabled
                        startInLoadingState
                        renderLoading={() => (
                            <View style={StyleSheet.absoluteFillObject as any}>
                                <LinearGradient colors={['#0F2027', '#203A43', '#2C5364']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                    <ActivityIndicator size="large" color="#00f2fe" />
                                    <Text style={styles.loadingText}>Loading Portal...</Text>
                                </LinearGradient>
                            </View>
                        )}
                    />
                </SafeAreaView>
            </LinearGradient>
        );
    }

    // ─── DASHBOARD ───────────────────────────────────────────────────────────────
    const totalClasses = attendanceData.reduce((a, c) => a + parseInt(c.marked || '0'), 0);
    const totalPresent = attendanceData.reduce((a, c) => a + parseInt(c.present || '0'), 0);
    const overallPercentage = totalClasses === 0 ? 0 : Math.round((totalPresent / totalClasses) * 100);

    const getColor = (pct: number) => pct >= 75 ? '#00b09b' : pct >= 60 ? '#f46b45' : '#ff4b1f';

    return (
        <LinearGradient colors={['#141E30', '#243B55']} style={styles.container}>
            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.dashHeader}>
                    <View>
                        <Text style={styles.dashTitle}>Attendance Hub</Text>
                        <Text style={styles.dashByline}>Created by Aayush :)</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.wpBtn}
                        onPress={() => Linking.openURL('https://api.whatsapp.com/send?phone=916207306283')}
                    >
                        <Text style={styles.wpBtnText}>💬 Contact Me</Text>
                    </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                    {/* Overall Card */}
                    <MotiView
                        from={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', delay: 100 }}
                        style={styles.card}
                    >
                        <LinearGradient colors={['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)']} style={styles.cardInner}>
                            <Text style={styles.summaryLabel}>OVERALL ATTENDANCE</Text>
                            <Text style={[styles.summaryBig, { color: getColor(overallPercentage) }]}>{overallPercentage}%</Text>
                            <View style={styles.summaryStats}>
                                <View style={styles.statBox}>
                                    <Text style={styles.statVal}>{totalPresent}</Text>
                                    <Text style={styles.statLabel}>Present</Text>
                                </View>
                                <View style={styles.statBox}>
                                    <Text style={styles.statVal}>{totalClasses - totalPresent}</Text>
                                    <Text style={styles.statLabel}>Absent</Text>
                                </View>
                                <View style={styles.statBox}>
                                    <Text style={styles.statVal}>{totalClasses}</Text>
                                    <Text style={styles.statLabel}>Total</Text>
                                </View>
                            </View>
                        </LinearGradient>
                    </MotiView>

                    {/* Bunk Calculator */}
                    <MotiView
                        from={{ opacity: 0, translateY: 30 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ type: 'timing', delay: 200 }}
                        style={styles.card}
                    >
                        <LinearGradient colors={['rgba(0,242,254,0.1)', 'rgba(0,242,254,0.03)']} style={styles.cardInner}>
                            <Text style={styles.sectionTitle}>Bunk Calculator</Text>
                            <Text style={styles.bunkSubtitle}>How many classes can you skip?</Text>

                            {/* Target Selector */}
                            <View style={styles.targetRow}>
                                {BUNK_TARGETS.map((t) => (
                                    <TouchableOpacity
                                        key={t}
                                        style={[styles.targetBtn, bunkTarget === t && styles.targetBtnActive]}
                                        onPress={() => setBunkTarget(t)}
                                    >
                                        <Text style={[styles.targetBtnText, bunkTarget === t && styles.targetBtnTextActive]}>
                                            Target {t}%
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Per subject bunk info */}
                            {attendanceData.map((course, i) => {
                                const present = parseInt(course.present || '0');
                                const total = parseInt(course.marked || '0');
                                const result = calcBunk(present, total, bunkTarget);
                                const isBunk = result.startsWith('Bunk');
                                const courseName = course.course.replace(/\\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                                return (
                                    <View key={i} style={styles.bunkRow}>
                                        <Text style={styles.bunkCourseName} numberOfLines={2}>{courseName}</Text>
                                        <View style={[styles.bunkBadge, { backgroundColor: isBunk ? 'rgba(0,176,155,0.2)' : 'rgba(255,75,31,0.2)' }]}>
                                            <Text style={[styles.bunkBadgeText, { color: isBunk ? '#00b09b' : '#ff4b1f' }]}>{result}</Text>
                                        </View>
                                    </View>
                                );
                            })}
                        </LinearGradient>
                    </MotiView>

                    {/* Subject Cards */}
                    <Text style={styles.sectionTitle}>Subjects</Text>
                    {attendanceData.map((course, index) => {
                        const perc = parseInt(course.percentage);
                        const color = getColor(perc);
                        // Fix newlines in course name
                        const courseName = course.course.replace(/\\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

                        return (
                            <MotiView
                                key={index}
                                from={{ opacity: 0, translateY: 50 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ type: 'timing', delay: 300 + index * 80 }}
                                style={styles.courseCard}
                            >
                                <LinearGradient colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)']} style={styles.courseInner}>
                                    <View style={styles.courseTop}>
                                        <View style={styles.courseIconWrapper}>
                                            <Book size={18} color={color} />
                                        </View>
                                        <View style={styles.courseNameWrapper}>
                                            <Text style={styles.courseName}>{courseName}</Text>
                                        </View>
                                        <View style={[styles.percentageBadge, { backgroundColor: color + '22' }]}>
                                            <Text style={[styles.coursePercentage, { color }]}>{course.percentage}%</Text>
                                        </View>
                                    </View>

                                    <View style={styles.courseBottom}>
                                        <View style={styles.miniStat}>
                                            <Clock size={13} color="#aaa" />
                                            <Text style={styles.miniStatText}>Total: {course.marked}</Text>
                                        </View>
                                        <View style={styles.miniStat}>
                                            <CheckCircle size={13} color="#00b09b" />
                                            <Text style={styles.miniStatText}>Present: {course.present}</Text>
                                        </View>
                                        <View style={styles.miniStat}>
                                            <XCircle size={13} color="#ff4b1f" />
                                            <Text style={styles.miniStatText}>Absent: {course.absent}</Text>
                                        </View>
                                    </View>

                                    <View style={styles.progressBarBg}>
                                        <MotiView
                                            from={{ width: '0%' }}
                                            animate={{ width: `${perc}%` }}
                                            transition={{ type: 'spring', delay: 400 + index * 100 }}
                                            style={[styles.progressBarFill, { backgroundColor: color }]}
                                        />
                                    </View>
                                </LinearGradient>
                            </MotiView>
                        );
                    })}

                    <View style={{ height: 40 }} />
                </ScrollView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    splashTitle: { fontSize: 40, fontWeight: 'bold', color: '#00f2fe', marginBottom: 16, textAlign: 'center' },
    splashBy: { fontSize: 18, color: '#ccc', fontStyle: 'italic' },
    webviewHeader: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#0F2027' },
    webviewTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    loadingText: { color: '#fff', marginTop: 15, fontSize: 16 },
    dashHeader: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
    dashTitle: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
    dashByline: { fontSize: 13, color: '#00f2fe', fontStyle: 'italic', marginTop: 2 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 20 },
    card: { width: '100%', borderRadius: 20, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    cardInner: { padding: 20, alignItems: 'center' },
    summaryLabel: { color: '#aaa', fontSize: 13, letterSpacing: 1, marginBottom: 8 },
    summaryBig: { fontSize: 60, fontWeight: 'bold', marginBottom: 16 },
    summaryStats: { flexDirection: 'row', width: '100%', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 16 },
    statBox: { alignItems: 'center' },
    statVal: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
    statLabel: { color: '#aaa', fontSize: 12, marginTop: 4 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 12, alignSelf: 'flex-start' },
    bunkSubtitle: { color: '#aaa', fontSize: 13, marginBottom: 14, alignSelf: 'flex-start' },
    targetRow: { flexDirection: 'row', marginBottom: 16, gap: 10, alignSelf: 'flex-start' },
    targetBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    targetBtnActive: { backgroundColor: 'rgba(0,242,254,0.2)', borderColor: '#00f2fe' },
    targetBtnText: { color: '#aaa', fontWeight: '600', fontSize: 13 },
    targetBtnTextActive: { color: '#00f2fe' },
    bunkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
    bunkCourseName: { color: '#ddd', fontSize: 13, flex: 1, marginRight: 10 },
    bunkBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
    bunkBadgeText: { fontWeight: 'bold', fontSize: 12 },
    courseCard: { marginBottom: 14, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    courseInner: { padding: 14 },
    courseTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    courseIconWrapper: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    courseNameWrapper: { flex: 1 },
    courseName: { color: '#fff', fontSize: 14, fontWeight: '600', lineHeight: 20 },
    percentageBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    coursePercentage: { fontWeight: 'bold', fontSize: 13 },
    courseBottom: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    miniStat: { flexDirection: 'row', alignItems: 'center' },
    miniStatText: { color: '#ccc', fontSize: 12, marginLeft: 5 },
    progressBarBg: { height: 5, width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
    progressBarFill: { height: '100%', borderRadius: 3 },
    wpBtn: { backgroundColor: 'rgba(37,211,102,0.2)', borderWidth: 1, borderColor: 'rgba(37,211,102,0.5)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
    wpBtnText: { color: '#25D366', fontWeight: '700', fontSize: 13 },
});

