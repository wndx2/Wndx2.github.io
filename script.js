document.addEventListener('DOMContentLoaded', () => {
    const nameElement = document.getElementById('name');
    if (!nameElement) {
        console.error("Element with ID 'name' not found.");
        return;
    }
    
    const names = [
        "wndud", "wnd", "wndu", "wndi", "James",
        "Juyoung", "PARK", "주영", "박주영", "ㅈㅇ",
        "ㅂㅈㅇ", "James Park", "Juyoung Park",
        "James (Juyoung) Park"
    ];
    let nameIndex = Math.floor(Math.random() * names.length);
    let charIndex = 0;
    let isDeleting = false;
    const typingSpeed = 150;
    const deletingSpeed = 100;
    const delayBetweenWords = 2000;

    function type() {
        const currentName = names[nameIndex];
        
        if (isDeleting) {
            // Handle deleting
            nameElement.textContent = currentName.substring(0, charIndex - 1) || '\u00A0';
            charIndex--;
            if (charIndex === 0) {
                isDeleting = false;
                
                // Get a new random index that is different from the current one
                let newIndex;
                do {
                    newIndex = Math.floor(Math.random() * names.length);
                } while (newIndex === nameIndex);
                nameIndex = newIndex;

                setTimeout(type, 500);
            } else {
                setTimeout(type, deletingSpeed);
            }
        } else {
            // Handle typing
            nameElement.textContent = currentName.substring(0, charIndex + 1);
            charIndex++;
            if (charIndex === currentName.length) {
                isDeleting = true;
                setTimeout(type, delayBetweenWords);
            } else {
                setTimeout(type, typingSpeed);
            }
        }
    }
    
    // Clear initial text and start the effect
    nameElement.textContent = '\u00A0'; 
    type();

    const liveTimeElement = document.getElementById('live-time');
    const totalDaysElement = document.getElementById('total-days');
    const totalHoursElement = document.getElementById('total-hours');
    const totalMinutesElement = document.getElementById('total-minutes');
    const totalSecondsElement = document.getElementById('total-seconds');

    if (liveTimeElement && totalDaysElement && totalHoursElement && totalMinutesElement && totalSecondsElement) {
        const birthDate = new Date('2009-11-08T00:00:00');
        
        function updateLiveTime() {
            const now = new Date();
            const diff = now - birthDate;

            // Detailed breakdown
            const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
            const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            liveTimeElement.textContent = `${years} years, ${days} days, ${hours} hours, ${minutes} minutes, and ${seconds} seconds.`;

            // Totals
            const totalDays = Math.floor(diff / (1000 * 60 * 60 * 24));
            const totalHours = Math.floor(diff / (1000 * 60 * 60));
            const totalMinutes = Math.floor(diff / (1000 * 60));
            const totalSeconds = Math.floor(diff / 1000);

            totalDaysElement.textContent = `or ${totalDays.toLocaleString()} days.`;
            totalHoursElement.textContent = `or ${totalHours.toLocaleString()} hours.`;
            totalMinutesElement.textContent = `or ${totalMinutes.toLocaleString()} minutes.`;
            totalSecondsElement.textContent = `or ${totalSeconds.toLocaleString()} seconds.`;
        }

        setInterval(updateLiveTime, 1000);
        updateLiveTime(); // Initial call
    }
});