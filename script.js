document.addEventListener('DOMContentLoaded', () => {
    const nameElement = document.getElementById('name');
    if (!nameElement) {
        console.error("Element with ID 'name' not found.");
        return;
    }
    
    const names = ["wndud", "wnd", "wndu", "wndi", "james", "juyoung", "park", "주영", "박주영", "ㅈㅇ", "ㅂㅈㅇ"];
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
});