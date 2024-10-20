const express = require('express');
const mysql = require('mysql');
const app = express();
const session = require('express-session');

const cors = require('cors');

const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(session({
  secret: 'your secret key',
  resave: false,
  saveUninitialized: true
}));



const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Sumakar@mysql5',
  database: 'attendance'
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed: ' + err.stack);
    return;
  }
  console.log('Connected to database.');
});

app.get('/', (req, res) => {
  res.render('landing');
});

app.get('/student_login', (req, res) => {
  res.render('student_login');
});

app.get('/faculty_login', (req, res) => {
  res.render('faculty_login');
});


app.post('/student_login', (req, res) => {
  const { username, password} = req.body;
  

  const query = 'SELECT * FROM user WHERE username = ? AND passkey = ? AND usertype = "student"';
  db.query(query, [username, password], (err, results) => {
    if (err) throw err;

    

    if (results.length > 0) {
      const userId = results[0].userid;
      req.session.userid = userId;
      const studentQuery = 'SELECT * FROM student WHERE userid = ?';
      
      db.query(studentQuery, [userId], (err, studentResults) => {
        if (err) throw err;

        if (studentResults.length > 0) {
          const studentId = studentResults[0].studentid;
          const attendanceQuery = `
            SELECT 
              course.coursename, 
              CONCAT(instructor.instructorfname, ' ', instructor.instructormname, ' ', instructor.instructorlname) AS faculty_name,
              COUNT(class.classid) AS total_classes,
              SUM(CASE WHEN attends.attendancestatus = 'present' THEN 1 ELSE 0 END) AS present_classes
            FROM 
              enrolls
              JOIN course ON enrolls.courseid = course.courseid
              JOIN instructs ON course.courseid = instructs.courseid
              JOIN instructor ON instructs.instructorid = instructor.instructorid
              JOIN class ON course.courseid = class.courseid AND class.instructorid = instructor.instructorid
              LEFT JOIN attends ON class.classid = attends.classid AND attends.studentid = ?
            WHERE 
              enrolls.studentid = ?
            GROUP BY 
              course.coursename, faculty_name
          `;

          db.query(attendanceQuery, [studentId, studentId], (err, attendanceResults) => {
            if (err) throw err;

            res.render('student_attendance', { student: studentResults[0], attendance: attendanceResults });
          });
        } else {
          res.send('Student not found.');
        }
      });
    } else {
      res.send('Invalid username or password');
    }
  });
});


app.post('/faculty_login', (req, res) => {
  const { username, password, userid } = req.body;

  const query = 'SELECT * FROM user WHERE username = ? AND passkey = ? AND usertype = "teach"';
  db.query(query, [username, password], (err, results) => {
    if (err) throw err;

    if (results.length > 0) {
      const userId = results[0].userid;
      const facultyQuery = 'SELECT * FROM instructor WHERE userid = ?';
      
      db.query(facultyQuery, [userId], (err, facultyResults) => {
        if (err) throw err;

        if (facultyResults.length > 0) {
          const instructorId = facultyResults[0].instructorid;
          const coursesQuery = `
            SELECT course.courseid, course.coursename 
            FROM instructs 
            JOIN course ON instructs.courseid = course.courseid 
            WHERE instructs.instructorid = ?
          `;

          db.query(coursesQuery, [instructorId], (err, courses) => {
            if (err) throw err;

            res.render('mark_attendance', { instructorid: instructorId, courses: courses });
          });
        } else {
          res.send('Faculty not found.');
        }
      });
    } else {
      res.send('Invalid username or password');
    }
  });
});



app.get('/get_students', (req, res) => {
  const { courseid } = req.query;

  const studentsQuery = `
    SELECT student.studentid, student.fname, student.lname 
    FROM enrolls 
    JOIN student ON enrolls.studentid = student.studentid 
    WHERE enrolls.courseid = ?
  `;

  db.query(studentsQuery, [courseid], (err, results) => {
    if (err) throw err;

    res.json(results);
  });
});



// Add this route to handle the form submission from mark_attendance.ejs
app.post('/mark_attendance', (req, res) => {
  const { instructorid, courseid, date, time, absentees } = req.body;

  // Fetch all students enrolled in the selected course
  const enrolledStudentsQuery = `
    SELECT s.studentid
    FROM enrolls e
    JOIN student s ON e.studentid = s.studentid
    WHERE e.courseid = ?
  `;

  db.query(enrolledStudentsQuery, [courseid], (err, students) => {
    if (err) throw err;

    // Parse absentees from the request
    const absenteesArray = absentees ? absentees.split(',').map(id => id.trim()) : [];

    // Fetch the class ID for the selected course, instructor, date, and time
    const classQuery = `
      SELECT classid FROM class 
      WHERE courseid = ? AND instructorid = ? AND starttime <= ? AND endtime >= ?
    `;

    db.query(classQuery, [courseid, instructorid, time, time], (err, classResults) => {
      if (err) throw err;

      if (classResults.length > 0) {
        const classid = classResults[0].classid;

        // Mark all students as present initially
        students.forEach(student => {
          const status = absenteesArray.includes(student.studentid) ? 'absent' : 'present';
          const insertAttendanceQuery = `
            INSERT INTO attends (studentid, classid, attendancestatus, attendancedate)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE attendancestatus = VALUES(attendancestatus)
          `;

          db.query(insertAttendanceQuery, [student.studentid, classid, status, date], (err, results) => {
            if (err) throw err;
          });
        });

        res.send('Attendance marked successfully.');
      } else {
        res.send('Class not found.');
      }
    });
  });
});



app.get('/apply_leave', (req, res) => {
  const userid = req.session.userid;
  const query = `
  SELECT studentid
  FROM student
  WHERE userid = ?
  `;

  var studentID = ""
  db.query(query, [userid], (err, results) => {
    if (err) {
      console.error('Error retrieving student ID:', err);
      res.sendStatus(500); 
      return;
    }
  
    if (results.length === 0) {
      console.log('Student ID not found for user ID:', userid);
      res.sendStatus(404);
      return;
    }
  
    studentID = results[0].studentid;  
  });

  const studentQuery = `
      SELECT s.fname, s.lname, s.studentid, s.department
      FROM student s
      WHERE s.userid = ?
  `;
  db.query(studentQuery, [userid], (err, studentResult) => {
      if (err) {
          console.error('Error fetching student details:', err);
          res.sendStatus(500);
          return;
      }      
      
      if (!studentResult[0]) {
          res.render('apply_leave', { student: null });
      } else {
          res.render('apply_leave', { student: studentResult[0] });
      }
  });
});




app.get('/apply_leave', (req, res) => {
  const userid = req.session.userid;
  
  var studentID = ""
  db.query(query, [userid], (err, results) => {
    if (err) {
      console.error('Error retrieving student ID:', err);
      res.sendStatus(500); 
      return;
    }
  
    if (results.length === 0) {
      console.log('Student ID not found for user ID:', userid);
      res.sendStatus(404);
      return;
    }
  
    studentID = results[0].studentid;  
    req.session.studentID = studentID
  });

  const studentQuery = `
    SELECT s.fname, s.lname, s.studentid, s.department
    FROM student s
    WHERE s.userid = ?
  `;
  db.query(studentQuery, [userid], (err, studentResult) => {
    if (err) {
      console.error('Error fetching student details:', err);
      res.sendStatus(500);
      return;
    }

    if (!studentResult || studentResult.length === 0) {
      console.error('No student details found.');
      res.render('apply_leave', { student: null });
      return;
    }

    res.render('apply_leave', { student: studentResult[0] });
  });
});





app.post('/apply_leave', (req, res) => {
  const userid = req.session.userid;
  const query = `
    SELECT studentid
    FROM student
    WHERE userid = ?
  `;
  db.query(query, [userid], (err, results) => {
    if (err) {
      console.error('Error retrieving student ID:', err);
      res.sendStatus(500);
      return;
    }
    if (results.length === 0) {
      console.log('Student ID not found for user ID:', userid);
      res.sendStatus(404);
      return;
    }
    const studentID = results[0].studentid;

    const { startDate, endDate, reason, type } = req.body;

    const latestLeaveRequestQuery = `
      SELECT leavereqid
      FROM leaverequest
      ORDER BY leavereqid DESC
      LIMIT 1
    `;
    db.query(latestLeaveRequestQuery, (err, results) => {
      if (err) {
        console.error('Error retrieving latest leave request ID:', err);
        res.sendStatus(500);
        return;
      }

      let latestRequestId = 0;
      if (results.length > 0) {
        latestRequestId = parseInt(results[0].leavereqid.substr(1));
      }

      const newRequestId = 'l' + ('000' + (latestRequestId + 1)).slice(-3);

      const stts = 'pending';

      const insertLeaveQuery = `
        INSERT INTO leaverequest (leavereqid, studentid, leavestartdate, leaveenddate, leavetype, leavereason, leavestatus)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(insertLeaveQuery, [newRequestId, studentID, startDate, endDate, type, reason, stts], (err, result) => {
        if (err) {
          console.error('Error inserting leave request:', err);
          res.sendStatus(500);
          return;
        }

        res.send('Leave request inserted successfully');
      });
    });
  });
});



app.get('/leave_history', (req, res) => {
  const userid = req.session.userid;
  
  const query1 = `
    SELECT studentid
    FROM student
    WHERE userid = ?
  `;

  db.query(query1, [userid], (err, results) => {
    if (err) {
      console.error('Error retrieving student ID:', err);
      res.sendStatus(500);
      return;
    }
  
    if (results.length === 0) {
      console.log('Student ID not found for user ID:', userid);
      res.sendStatus(404);
      return;
    }
  
    const studentID = results[0].studentid;  

    const query = `
      SELECT DATE_FORMAT(leavestartdate, '%Y-%m-%d') AS leavestartdate,
             DATE_FORMAT(leaveenddate, '%Y-%m-%d') AS leaveenddate,
             leavetype, leavereason, leavestatus
      FROM leaverequest
      WHERE studentid = ?
    `;

    db.query(query, [studentID], (err, results) => {
      if (err) {
        console.error('Error retrieving leave history:', err);
        res.sendStatus(500); 
        return;
      }
      res.render('leave_history', { leaves: results });
    });
  });
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
